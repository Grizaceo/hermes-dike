//! Native stdin -> GBIN adapter. Upstream Graphium CSR/layout retained under MIT.
#![allow(dead_code)]
mod csr;
mod layout;
mod incremental;
use csr::{GraphBuilder, NodeLayer};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::io::{self, Read, Write};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input { nodes: Vec<Node>, links: Vec<Link> }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Node { id: String, tipo: String, label: String, #[serde(default)] position: Option<[f32; 3]> }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Link { source: String, target: String, tipo: String, estado: String }

fn convert(raw: &[u8]) -> Result<Vec<u8>, String> {
    let input: Input = serde_json::from_slice(raw).map_err(|_| "Invalid graph JSON")?;
    if input.nodes.len() > 200_000 || input.links.len() > 1_000_000 { return Err("Graph exceeds limits".into()); }
    let mut builder = GraphBuilder::new("dike", "Diké: proyección documental, no certificación");
    let mut ids = HashMap::new();
    let mut parents = HashMap::new();
    let mut edge_types = HashSet::new();
    for node in input.nodes {
        if node.id.is_empty() || ids.contains_key(&node.id) { return Err("Duplicate or empty node ID".into()); }
        let id = builder.upsert_node(&node.id, &node.label, &node.tipo, NodeLayer::Review, "", "");
        if let Some(pos) = node.position {
            if pos.iter().any(|v| !v.is_finite() || v.abs() > 10_000_000.) { return Err("Invalid preset position".into()); }
            builder.nodes[id as usize].preset_pos = Some(pos);
        }
        ids.insert(node.id, id);
    }
    for link in input.links {
        let src = *ids.get(&link.source).ok_or("Unknown source")?;
        let dst = *ids.get(&link.target).ok_or("Unknown target")?;
        let kind = serde_json::to_string(&[&link.tipo, &link.estado]).map_err(|_| "Invalid edge kind")?;
        edge_types.insert(kind.clone());
        if edge_types.len() > 63 { return Err("Too many edge kinds".into()); }
        if link.tipo == "contiene" && src != dst { parents.entry(dst).or_insert(src); }
        let layer = if link.tipo == "contiene" { NodeLayer::Structural } else { NodeLayer::Review };
        // Imported relations do not become canonical by visualization.
        builder.add_edge(src, dst, &kind, layer, 1);
    }
    if builder.node_kinds.len() > 254 || builder.edge_kinds.len() > 63 { return Err("Too many kinds".into()); }
    let (pinned, gap) = incremental::seed(&mut builder, &parents);
    let mut graph = builder.build();
    incremental::relax(&mut graph, &pinned, gap);
    Ok(graph.to_gbin_bytes())
}

fn main() {
    let mut raw = Vec::new();
    let result = io::stdin().take(64 * 1024 * 1024 + 1).read_to_end(&mut raw)
        .map_err(|_| "Cannot read stdin".to_string())
        .and_then(|_| if raw.len() > 64 * 1024 * 1024 { Err("Input exceeds limits".into()) } else { convert(&raw) });
    match result {
        Ok(bytes) => if io::stdout().write_all(&bytes).is_err() { std::process::exit(2); },
        Err(error) => { eprintln!("{error}"); std::process::exit(1); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_endpoint_is_rejected() {
        let raw = br#"{"nodes":[],"links":[{"source":"x","target":"y","tipo":"cita","estado":"candidata"}]}"#;
        assert!(convert(raw).is_err());
    }
    fn header_count(bytes: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
    }
    fn point(bytes: &[u8], index: usize) -> [f32; 3] {
        std::array::from_fn(|axis| {
            let offset = 32 + index * 12 + axis * 4;
            f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
        })
    }
    fn typed_graph(kinds: usize) -> Vec<u8> {
        let links: Vec<_> = (0..kinds).map(|i| serde_json::json!({"source":"a","target":"b","tipo":"cita","estado":format!("state:{i}")})).collect();
        serde_json::to_vec(&serde_json::json!({"nodes":[{"id":"a","tipo":"node","label":"a"},{"id":"b","tipo":"node","label":"b"}],"links":links})).unwrap()
    }
    #[test]
    fn sixty_three_edge_kinds_pass_and_sixty_four_fail_explicitly() {
        assert_eq!(header_count(&convert(&typed_graph(63)).unwrap(), 12), 63);
        assert_eq!(convert(&typed_graph(64)).unwrap_err(), "Too many edge kinds");
    }
    #[test]
    fn deduplication_preserves_distinct_statuses() {
        let mut value: serde_json::Value = serde_json::from_slice(&typed_graph(2)).unwrap();
        let duplicate = value["links"][0].clone();
        value["links"].as_array_mut().unwrap().push(duplicate);
        assert_eq!(header_count(&convert(&serde_json::to_vec(&value).unwrap()).unwrap(), 12), 2);
    }
    #[test]
    fn new_siblings_are_separated_and_existing_nodes_remain_pinned() {
        let mut nodes = vec![serde_json::json!({"id":"parent","tipo":"node","label":"p","position":[0.,0.,0.]})];
        let mut links = Vec::new();
        for i in 0..32 {
            let id = format!("child:{i}");
            nodes.push(serde_json::json!({"id":id,"tipo":"node","label":id}));
            links.push(serde_json::json!({"source":"parent","target":id,"tipo":"contiene","estado":"candidata"}));
        }
        let bytes = convert(&serde_json::to_vec(&serde_json::json!({"nodes":nodes,"links":links})).unwrap()).unwrap();
        assert_eq!(point(&bytes, 0), [0.,0.,0.]);
        for a in 1..33 {
            let pa = point(&bytes, a);
            for b in a + 1..33 {
                let pb = point(&bytes, b);
                let squared: f32 = (0..3).map(|axis| (pa[axis] - pb[axis]).powi(2)).sum();
                assert!(squared >= 64., "siblings {a} and {b} overlap: squared distance {squared}");
            }
        }
    }
    #[test]
    fn all_presets_are_exactly_preserved() {
        let value = serde_json::json!({"nodes":[{"id":"a","tipo":"node","label":"a","position":[50.,60.,70.]},{"id":"b","tipo":"node","label":"b","position":[80.,90.,100.]}],"links":[]});
        let bytes = convert(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(point(&bytes,0),[50.,60.,70.]);
        assert_eq!(point(&bytes,1),[80.,90.,100.]);
    }
    #[test]
    fn native_refinement_moves_only_unpinned_coincident_nodes() {
        let mut builder = GraphBuilder::new("fixture", "fixture");
        for i in 0..3 {
            let id = builder.upsert_node(&format!("node:{i}"), "node", "node", NodeLayer::Review, "", "");
            builder.nodes[id as usize].preset_pos = Some([0.,0.,0.]);
        }
        builder.add_edge(0,1,"contiene",NodeLayer::Structural,1);
        builder.add_edge(0,2,"contiene",NodeLayer::Structural,1);
        let mut graph = builder.build();
        incremental::relax(&mut graph, &[true,false,false], 24.);
        assert_eq!(&graph.positions[..3], &[0.,0.,0.]);
        let separation: f32 = (0..3).map(|a| (graph.positions[3+a]-graph.positions[6+a]).powi(2)).sum();
        assert!(separation > 1.);
        assert!(graph.positions.iter().all(|v| v.is_finite()));
    }
    fn assert_pins_survive_new_containment(links: serde_json::Value) {
        let value = serde_json::json!({"nodes":[
            {"id":"p","tipo":"node","label":"p","position":[500.,0.,0.]},
            {"id":"q","tipo":"node","label":"q","position":[-700.,20.,30.]},
            {"id":"x","tipo":"node","label":"x"},
            {"id":"y","tipo":"node","label":"y"}
        ],"links":links});
        let bytes = convert(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(point(&bytes,0),[500.,0.,0.]);
        assert_eq!(point(&bytes,1),[-700.,20.,30.]);
        for i in 0..4 { assert!(point(&bytes,i).iter().all(|v| v.is_finite())); }
    }
    #[test]
    fn pins_survive_acyclic_new_containment_control() {
        assert_pins_survive_new_containment(serde_json::json!([
            {"source":"p","target":"x","tipo":"contiene","estado":"candidata"},
            {"source":"x","target":"y","tipo":"contiene","estado":"candidata"}
        ]));
    }
    #[test]
    fn pins_survive_new_containment_self_loop() {
        assert_pins_survive_new_containment(serde_json::json!([
            {"source":"x","target":"x","tipo":"contiene","estado":"candidata"}
        ]));
    }
    #[test]
    fn pins_survive_new_containment_cycle() {
        assert_pins_survive_new_containment(serde_json::json!([
            {"source":"x","target":"y","tipo":"contiene","estado":"candidata"},
            {"source":"y","target":"x","tipo":"contiene","estado":"candidata"}
        ]));
    }
    #[test]
    fn valid_empty_snapshot() {
        let out = convert(br#"{"nodes":[],"links":[]}"#).unwrap();
        assert_eq!(&out[..4], b"GBIN");
    }
}
