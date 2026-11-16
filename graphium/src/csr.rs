use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::Path;

pub const GBIN_MAGIC: u32 = 0x4E49_4247; // "GBIN" LE
pub const GBIN_VERSION: u32 = 1;
pub const GIDX_MAGIC: u32 = 0x5844_4947; // "GIDX" LE
pub const GIDX_VERSION: u32 = 2;

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeLayer {
    Canonical = 0,
    Review = 1,
    Structural = 2,
    Tag = 3,
}

impl NodeLayer {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Review,
            2 => Self::Structural,
            3 => Self::Tag,
            _ => Self::Canonical,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Canonical => "canonical",
            Self::Review => "review",
            Self::Structural => "structural",
            Self::Tag => "tag",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RawNode {
    pub key: String,
    pub label: String,
    pub kind: String,
    pub layer: NodeLayer,
    pub path: String,
    pub snippet: String,
    pub preset_pos: Option<[f32; 3]>,
}

#[derive(Debug, Clone)]
pub struct RawEdge {
    pub src: u32,
    pub dst: u32,
    pub kind: u8,
    pub layer: NodeLayer,
    pub weight: u16,
}

pub struct GraphBuilder {
    pub source_id: String,
    pub source_label: String,
    pub nodes: Vec<RawNode>,
    pub node_lookup: HashMap<String, u32>,
    pub edges: Vec<RawEdge>,
    pub node_kinds: Vec<String>,
    pub node_kind_map: HashMap<String, u8>,
    pub edge_kinds: Vec<String>,
    pub edge_kind_map: HashMap<String, u8>,
}

impl GraphBuilder {
    pub fn new(source_id: impl Into<String>, source_label: impl Into<String>) -> Self {
        Self {
            source_id: source_id.into(),
            source_label: source_label.into(),
            nodes: Vec::new(),
            node_lookup: HashMap::new(),
            edges: Vec::new(),
            node_kinds: Vec::new(),
            node_kind_map: HashMap::new(),
            edge_kinds: Vec::new(),
            edge_kind_map: HashMap::new(),
        }
    }

    pub fn intern_node_kind(&mut self, kind: &str) -> u8 {
        if let Some(&idx) = self.node_kind_map.get(kind) {
            return idx;
        }
        let idx = (self.node_kinds.len().min(254)) as u8;
        if (idx as usize) == self.node_kinds.len() {
            self.node_kinds.push(kind.to_string());
            self.node_kind_map.insert(kind.to_string(), idx);
        }
        idx
    }

    pub fn intern_edge_kind(&mut self, kind: &str) -> u8 {
        if let Some(&idx) = self.edge_kind_map.get(kind) {
            return idx;
        }
        let idx = (self.edge_kinds.len().min(62)) as u8;
        if (idx as usize) == self.edge_kinds.len() {
            self.edge_kinds.push(kind.to_string());
            self.edge_kind_map.insert(kind.to_string(), idx);
        }
        idx
    }

    pub fn upsert_node(
        &mut self,
        key: &str,
        label: &str,
        kind: &str,
        layer: NodeLayer,
        path: &str,
        snippet: &str,
    ) -> u32 {
        self.intern_node_kind(kind);
        if let Some(&id) = self.node_lookup.get(key) {
            let existing = &mut self.nodes[id as usize];
            if existing.kind == "unresolved" && kind != "unresolved" {
                existing.kind = kind.to_string();
                existing.layer = layer;
            }
            if existing.path.is_empty() && !path.is_empty() {
                existing.path = path.to_string();
            }
            if existing.snippet.is_empty() && !snippet.is_empty() {
                existing.snippet = truncate_utf8(snippet, 360);
            }
            if (existing.label.is_empty() || existing.label == existing.key) && !label.is_empty() {
                existing.label = truncate_utf8(label, 140);
            }
            return id;
        }
        let id = self.nodes.len() as u32;
        self.node_lookup.insert(key.to_string(), id);
        self.nodes.push(RawNode {
            key: key.to_string(),
            label: truncate_utf8(if label.is_empty() { key } else { label }, 140),
            kind: kind.to_string(),
            layer,
            path: path.to_string(),
            snippet: truncate_utf8(snippet, 360),
            preset_pos: None,
        });
        id
    }

    pub fn add_edge(&mut self, src: u32, dst: u32, kind: &str, layer: NodeLayer, weight: u16) {
        if src == dst {
            return;
        }
        let kind_idx = self.intern_edge_kind(kind);
        self.edges.push(RawEdge {
            src,
            dst,
            kind: kind_idx,
            layer,
            weight: weight.max(1),
        });
    }

    pub fn build(mut self) -> CsrGraph {
        let n = self.nodes.len();
        // Deduplicate parallel edges of same (src, dst, kind)
        self.edges.sort_unstable_by(|a, b| {
            a.src
                .cmp(&b.src)
                .then_with(|| a.dst.cmp(&b.dst))
                .then_with(|| a.kind.cmp(&b.kind))
        });
        let mut dedup_edges: Vec<RawEdge> = Vec::with_capacity(self.edges.len());
        for edge in self.edges.into_iter() {
            if let Some(last) = dedup_edges.last_mut() {
                if last.src == edge.src && last.dst == edge.dst && last.kind == edge.kind {
                    last.weight = last.weight.saturating_add(edge.weight);
                    if edge.layer == NodeLayer::Canonical {
                        last.layer = NodeLayer::Canonical;
                    }
                    continue;
                }
            }
            dedup_edges.push(edge);
        }

        let e_count = dedup_edges.len();
        let mut out_offsets = vec![0u32; n + 1];
        let mut out_targets = Vec::with_capacity(e_count);
        let mut out_meta = Vec::with_capacity(e_count);
        let mut edge_pairs = Vec::with_capacity(e_count * 2);

        let mut in_counts = vec![0u32; n];
        for e in &dedup_edges {
            out_offsets[e.src as usize + 1] += 1;
            in_counts[e.dst as usize] += 1;
        }
        for i in 0..n {
            out_offsets[i + 1] += out_offsets[i];
        }

        for e in &dedup_edges {
            out_targets.push(e.dst);
            let meta_byte = (e.kind & 0x3F) | ((e.layer as u8 & 0x03) << 6);
            out_meta.push(meta_byte);
            edge_pairs.push(e.src);
            edge_pairs.push(e.dst);
        }

        let mut in_offsets = vec![0u32; n + 1];
        for i in 0..n {
            in_offsets[i + 1] = in_offsets[i] + in_counts[i];
        }
        let mut in_targets = vec![0u32; e_count];
        let mut in_meta = vec![0u8; e_count];
        let mut cursor = in_offsets[..n].to_vec();
        for e in &dedup_edges {
            let pos = cursor[e.dst as usize] as usize;
            in_targets[pos] = e.src;
            in_meta[pos] = (e.kind & 0x3F) | ((e.layer as u8 & 0x03) << 6);
            cursor[e.dst as usize] += 1;
        }

        let mut node_kind_idx = Vec::with_capacity(n);
        let mut node_layer = Vec::with_capacity(n);
        let mut keys = Vec::with_capacity(n);
        let mut labels = Vec::with_capacity(n);
        let mut paths = Vec::with_capacity(n);
        let mut snippets = Vec::with_capacity(n);
        let mut positions = vec![0.0f32; n * 3];
        let mut has_all_presets = n > 0;

        for (i, node) in self.nodes.into_iter().enumerate() {
            let k_idx = *self.node_kind_map.get(&node.kind).unwrap_or(&0);
            node_kind_idx.push(k_idx);
            node_layer.push(node.layer as u8);
            keys.push(node.key);
            labels.push(node.label);
            paths.push(node.path);
            snippets.push(node.snippet);
            if let Some([x, y, z]) = node.preset_pos {
                positions[i * 3] = x;
                positions[i * 3 + 1] = y;
                positions[i * 3 + 2] = z;
            } else {
                has_all_presets = false;
            }
        }

        let mut graph = CsrGraph {
            source_id: self.source_id,
            source_label: self.source_label,
            node_count: n as u32,
            edge_count: e_count as u32,
            node_kinds: self.node_kinds,
            edge_kinds: self.edge_kinds,
            out_offsets,
            out_targets,
            out_meta,
            in_offsets,
            in_targets,
            in_meta,
            edge_pairs,
            node_kind_idx,
            node_layer,
            clusters: vec![0u16; n],
            cluster_count: 0,
            positions,
            keys,
            labels,
            paths,
            snippets,
        };

        crate::layout::compute_clusters_and_layout(&mut graph, has_all_presets);
        graph
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LandmarkHub {
    pub id: u32,
    pub label: String,
    pub kind: String,
    pub layer: String,
    pub degree: u32,
    pub cluster: u16,
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterSummary {
    pub id: u16,
    pub label: String,
    pub count: u32,
    pub color: String,
    pub cx: f32,
    pub cy: f32,
    pub cz: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeSummary {
    pub id: u16,
    pub label: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotFooter {
    pub source_id: String,
    pub source_label: String,
    pub node_count: u32,
    pub edge_count: u32,
    pub node_kinds: Vec<String>,
    pub node_kind_colors: Vec<String>,
    pub node_kind_counts: Vec<u32>,
    pub edge_kinds: Vec<String>,
    pub edge_kind_counts: Vec<u32>,
    pub layer_counts: HashMap<String, u32>,
    pub hubs: Vec<LandmarkHub>,
    pub clusters: Vec<ClusterSummary>,
    #[serde(default)]
    pub scopes: Vec<ScopeSummary>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub node_scopes_b64: String,
    #[serde(default)]
    pub year_min: u16,
    #[serde(default)]
    pub year_max: u16,
    #[serde(default)]
    pub dated_count: u32,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub node_years_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsrGraph {
    pub source_id: String,
    pub source_label: String,
    pub node_count: u32,
    pub edge_count: u32,
    pub node_kinds: Vec<String>,
    pub edge_kinds: Vec<String>,
    pub out_offsets: Vec<u32>,
    pub out_targets: Vec<u32>,
    pub out_meta: Vec<u8>,
    pub in_offsets: Vec<u32>,
    pub in_targets: Vec<u32>,
    pub in_meta: Vec<u8>,
    pub edge_pairs: Vec<u32>,
    pub node_kind_idx: Vec<u8>,
    pub node_layer: Vec<u8>,
    pub clusters: Vec<u16>,
    pub cluster_count: u16,
    pub positions: Vec<f32>,
    pub keys: Vec<String>,
    pub labels: Vec<String>,
    pub paths: Vec<String>,
    pub snippets: Vec<String>,
}

impl CsrGraph {
    #[inline]
    pub fn out_degree(&self, u: u32) -> u32 {
        let i = u as usize;
        self.out_offsets[i + 1] - self.out_offsets[i]
    }

    #[inline]
    pub fn in_degree(&self, u: u32) -> u32 {
        let i = u as usize;
        self.in_offsets[i + 1] - self.in_offsets[i]
    }

    #[inline]
    pub fn total_degree(&self, u: u32) -> u32 {
        self.out_degree(u) + self.in_degree(u)
    }

    pub fn out_neighbors(&self, u: u32) -> (&[u32], &[u8]) {
        let s = self.out_offsets[u as usize] as usize;
        let e = self.out_offsets[u as usize + 1] as usize;
        (&self.out_targets[s..e], &self.out_meta[s..e])
    }

    pub fn in_neighbors(&self, u: u32) -> (&[u32], &[u8]) {
        let s = self.in_offsets[u as usize] as usize;
        let e = self.in_offsets[u as usize + 1] as usize;
        (&self.in_targets[s..e], &self.in_meta[s..e])
    }

    pub fn build_footer(&self, max_hubs: usize) -> SnapshotFooter {
        self.build_footer_with_arrays(max_hubs, false)
    }

    pub fn build_footer_with_arrays(&self, max_hubs: usize, include_node_arrays: bool) -> SnapshotFooter {
        let n = self.node_count as usize;
        let mut node_kind_counts = vec![0u32; self.node_kinds.len()];
        let mut layer_counts: HashMap<String, u32> = HashMap::new();
        for i in 0..n {
            let k = self.node_kind_idx[i] as usize;
            if k < node_kind_counts.len() {
                node_kind_counts[k] += 1;
            }
            let lname = NodeLayer::from_u8(self.node_layer[i]).as_str().to_string();
            *layer_counts.entry(lname).or_insert(0) += 1;
        }

        let mut edge_kind_counts = vec![0u32; self.edge_kinds.len()];
        for &m in &self.out_meta {
            let ek = (m & 0x3F) as usize;
            if ek < edge_kind_counts.len() {
                edge_kind_counts[ek] += 1;
            }
        }

        let node_kind_colors: Vec<String> = self
            .node_kinds
            .iter()
            .enumerate()
            .map(|(idx, k)| kind_hex_color(k, idx))
            .collect();

        // Rank top landmark hubs by degree
        let mut order: Vec<u32> = (0..self.node_count).collect();
        order.sort_unstable_by(|&a, &b| self.total_degree(b).cmp(&self.total_degree(a)));
        let hubs: Vec<LandmarkHub> = order
            .iter()
            .take(max_hubs)
            .filter(|&&id| self.total_degree(id) > 0 || self.node_count <= 32)
            .map(|&id| {
                let idx = id as usize;
                let k = self
                    .node_kinds
                    .get(self.node_kind_idx[idx] as usize)
                    .cloned()
                    .unwrap_or_else(|| "node".to_string());
                LandmarkHub {
                    id,
                    label: self.labels[idx].clone(),
                    kind: k,
                    layer: NodeLayer::from_u8(self.node_layer[idx]).as_str().to_string(),
                    degree: self.total_degree(id),
                    cluster: self.clusters[idx],
                    x: self.positions[idx * 3],
                    y: self.positions[idx * 3 + 1],
                    z: self.positions[idx * 3 + 2],
                }
            })
            .collect();

        // Cluster centroids and dominant hub label
        let c_len = self.cluster_count.max(1) as usize;
        let mut c_counts = vec![0u32; c_len];
        let mut c_sum = vec![[0.0f64; 3]; c_len];
        let mut c_best: Vec<Option<(u32, usize)>> = vec![None; c_len];
        for i in 0..n {
            let c = (self.clusters[i] as usize).min(c_len - 1);
            c_counts[c] += 1;
            c_sum[c][0] += self.positions[i * 3] as f64;
            c_sum[c][1] += self.positions[i * 3 + 1] as f64;
            c_sum[c][2] += self.positions[i * 3 + 2] as f64;
            let deg = self.total_degree(i as u32);
            if c_best[c].map_or(true, |(best_deg, _)| deg > best_deg) {
                c_best[c] = Some((deg, i));
            }
        }

        let mut clusters = Vec::new();
        for cid in 0..c_len {
            if c_counts[cid] == 0 {
                continue;
            }
            let cnt = c_counts[cid] as f64;
            let best_idx = c_best[cid].map(|(_, idx)| idx).unwrap_or(0);
            let k_idx = self.node_kind_idx.get(best_idx).copied().unwrap_or(0) as usize;
            let k_name = self.node_kinds.get(k_idx).map(|s| s.as_str()).unwrap_or("node");
            clusters.push(ClusterSummary {
                id: cid as u16,
                label: self
                    .labels
                    .get(best_idx)
                    .cloned()
                    .unwrap_or_else(|| format!("Cluster {cid}")),
                count: c_counts[cid],
                color: kind_hex_color(k_name, cid),
                cx: (c_sum[cid][0] / cnt) as f32,
                cy: (c_sum[cid][1] / cnt) as f32,
                cz: (c_sum[cid][2] / cnt) as f32,
            });
        }
        clusters.sort_unstable_by(|a, b| b.count.cmp(&a.count));

        let (scopes, node_scope_ids) = self.compute_scopes();
        let (year_min, year_max, dated_count, node_years) = self.compute_years();
        let node_scopes_b64 = if include_node_arrays && !node_scope_ids.is_empty() {
            encode_base64(&node_scope_ids)
        } else {
            String::new()
        };
        let node_years_b64 = if include_node_arrays && dated_count > 0 {
            let mut ybytes = Vec::with_capacity(node_years.len() * 2);
            for &y in &node_years {
                ybytes.extend_from_slice(&y.to_le_bytes());
            }
            encode_base64(&ybytes)
        } else {
            String::new()
        };

        SnapshotFooter {
            source_id: self.source_id.clone(),
            source_label: self.source_label.clone(),
            node_count: self.node_count,
            edge_count: self.edge_count,
            node_kinds: self.node_kinds.clone(),
            node_kind_colors,
            node_kind_counts,
            edge_kinds: self.edge_kinds.clone(),
            edge_kind_counts,
            layer_counts,
            hubs,
            clusters,
            scopes,
            node_scopes_b64,
            year_min,
            year_max,
            dated_count,
            node_years_b64,
        }
    }

    fn compute_scopes(&self) -> (Vec<ScopeSummary>, Vec<u8>) {
        let n = self.node_count as usize;
        if n == 0 {
            return (Vec::new(), Vec::new());
        }
        let mut raw_labels: Vec<String> = Vec::with_capacity(n);
        let mut counts: HashMap<String, u32> = HashMap::new();
        for i in 0..n {
            let k_idx = self.node_kind_idx[i] as usize;
            let k_name = self.node_kinds.get(k_idx).map(|s| s.as_str()).unwrap_or("node");
            let sc = derive_node_scope(&self.source_id, &self.keys[i], &self.paths[i], k_name);
            *counts.entry(sc.clone()).or_insert(0) += 1;
            raw_labels.push(sc);
        }

        let mut ranked: Vec<(String, u32)> = counts.into_iter().collect();
        ranked.sort_unstable_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

        let mut label_to_id: HashMap<String, u8> = HashMap::new();
        let mut summaries: Vec<ScopeSummary> = Vec::new();
        let cap = 48usize;
        for (idx, (lbl, cnt)) in ranked.iter().take(cap).enumerate() {
            let id = (idx + 1) as u8;
            label_to_id.insert(lbl.clone(), id);
            summaries.push(ScopeSummary {
                id: id as u16,
                label: lbl.clone(),
                count: *cnt,
            });
        }
        if ranked.len() > cap {
            let other_cnt: u32 = ranked[cap..].iter().map(|(_, c)| *c).sum();
            summaries.push(ScopeSummary {
                id: 0,
                label: "Otros".to_string(),
                count: other_cnt,
            });
        }

        let ids: Vec<u8> = raw_labels
            .into_iter()
            .map(|lbl| *label_to_id.get(&lbl).unwrap_or(&0))
            .collect();
        (summaries, ids)
    }

    fn compute_years(&self) -> (u16, u16, u32, Vec<u16>) {
        let n = self.node_count as usize;
        let mut years = vec![0u16; n];
        let mut ymin = u16::MAX;
        let mut ymax = 0u16;
        let mut dated = 0u32;
        for i in 0..n {
            if let Some(y) = extract_contextual_year(&self.snippets[i])
                .or_else(|| extract_contextual_year(&self.labels[i]))
                .or_else(|| extract_contextual_year(&self.paths[i]))
            {
                years[i] = y;
                dated += 1;
                if y < ymin {
                    ymin = y;
                }
                if y > ymax {
                    ymax = y;
                }
            }
        }
        if dated == 0 {
            (0, 0, 0, years)
        } else {
            (ymin, ymax, dated, years)
        }
    }

    /// Encode zero-copy GPU binary snapshot (GBIN v1):
    /// Header (32 B = 8 x u32 LE):
    ///   [magic, version, node_count, edge_count, node_kinds, edge_kinds, cluster_count, footer_len]
    /// Section 1: positions (node_count * 3 * f32 LE)
    /// Section 2: node_packed (node_count * 4 * u32 LE):
    ///   w0: kind_idx | (layer << 8) | (cluster << 16)
    ///   w1: total_degree
    ///   w2: radius (f32 bits)
    ///   w3: rgba8888 (0xRRGGBBAA)
    /// Section 3: edge_pairs (edge_count * 2 * u32 LE)
    /// Section 4: edge_meta (edge_count * u8, padded to 4-byte boundary)
    /// Section 5: UTF-8 JSON SnapshotFooter
    pub fn to_gbin_bytes(&self) -> Vec<u8> {
        let n = self.node_count as usize;
        let e = self.edge_count as usize;
        let footer = self.build_footer_with_arrays(96, true);
        let footer_bytes = serde_json::to_vec(&footer).unwrap_or_default();
        let edge_meta_padded = (e + 3) & !3;

        let total_bytes = 32 + (n * 12) + (n * 16) + (e * 8) + edge_meta_padded + footer_bytes.len();
        let mut out = Vec::with_capacity(total_bytes);

        for word in [
            GBIN_MAGIC,
            GBIN_VERSION,
            self.node_count,
            self.edge_count,
            self.node_kinds.len() as u32,
            self.edge_kinds.len() as u32,
            self.cluster_count as u32,
            footer_bytes.len() as u32,
        ] {
            out.extend_from_slice(&word.to_le_bytes());
        }

        // Section 1: positions
        for &coord in &self.positions {
            out.extend_from_slice(&coord.to_le_bytes());
        }

        // Section 2: node_packed
        let kind_rgba: Vec<u32> = self
            .node_kinds
            .iter()
            .enumerate()
            .map(|(i, k)| hex_to_rgba_u32(&kind_hex_color(k, i), 235))
            .collect();

        for i in 0..n {
            let k_idx = self.node_kind_idx[i];
            let layer = self.node_layer[i];
            let cluster = self.clusters[i];
            let deg = self.total_degree(i as u32);
            let base_r = 1.65f32 + ((deg as f32 + 1.0).ln() * 1.12);
            let radius = match layer {
                2 => (base_r * 1.18).clamp(2.4, 12.0),
                1 => (base_r * 0.92).clamp(1.5, 9.5),
                _ => base_r.clamp(1.7, 11.0),
            };
            let rgba = kind_rgba.get(k_idx as usize).copied().unwrap_or(0x7B8C_9EEB);
            let w0 = (k_idx as u32) | ((layer as u32) << 8) | ((cluster as u32) << 16);
            out.extend_from_slice(&w0.to_le_bytes());
            out.extend_from_slice(&deg.to_le_bytes());
            out.extend_from_slice(&radius.to_bits().to_le_bytes());
            out.extend_from_slice(&rgba.to_le_bytes());
        }

        // Section 3: edge_pairs
        for &v in &self.edge_pairs {
            out.extend_from_slice(&v.to_le_bytes());
        }

        // Section 4: edge_meta (padded to 4B)
        out.extend_from_slice(&self.out_meta);
        for _ in e..edge_meta_padded {
            out.push(0);
        }

        // Section 5: JSON footer
        out.extend_from_slice(&footer_bytes);
        out
    }

    pub fn save_cache(&self, gidx_path: &Path, gbin_path: &Path) -> std::io::Result<()> {
        if let Some(parent) = gidx_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp_gbin = gbin_path.with_extension("gbin.tmp");
        fs::write(&tmp_gbin, self.to_gbin_bytes())?;
        fs::rename(&tmp_gbin, gbin_path)?;

        let tmp_gidx = gidx_path.with_extension("gidx.tmp");
        {
            let f = File::create(&tmp_gidx)?;
            let mut w = BufWriter::with_capacity(256 * 1024, f);
            w.write_all(&GIDX_MAGIC.to_le_bytes())?;
            w.write_all(&GIDX_VERSION.to_le_bytes())?;
            write_str(&mut w, &self.source_id)?;
            write_str(&mut w, &self.source_label)?;
            w.write_all(&self.node_count.to_le_bytes())?;
            w.write_all(&self.edge_count.to_le_bytes())?;
            w.write_all(&(self.cluster_count as u32).to_le_bytes())?;
            write_str_vec(&mut w, &self.node_kinds)?;
            write_str_vec(&mut w, &self.edge_kinds)?;
            write_u32_slice(&mut w, &self.out_offsets)?;
            write_u32_slice(&mut w, &self.out_targets)?;
            write_u8_slice(&mut w, &self.out_meta)?;
            write_u32_slice(&mut w, &self.in_offsets)?;
            write_u32_slice(&mut w, &self.in_targets)?;
            write_u8_slice(&mut w, &self.in_meta)?;
            write_u32_slice(&mut w, &self.edge_pairs)?;
            write_u8_slice(&mut w, &self.node_kind_idx)?;
            write_u8_slice(&mut w, &self.node_layer)?;
            write_u16_slice(&mut w, &self.clusters)?;
            write_f32_slice(&mut w, &self.positions)?;
            write_str_vec(&mut w, &self.keys)?;
            write_str_vec(&mut w, &self.labels)?;
            write_str_vec(&mut w, &self.paths)?;
            write_str_vec(&mut w, &self.snippets)?;
            w.flush()?;
        }
        fs::rename(&tmp_gidx, gidx_path)?;
        Ok(())
    }

    pub fn load_cache(gidx_path: &Path) -> std::io::Result<Self> {
        let bytes = fs::read(gidx_path)?;
        let mut cur: &[u8] = &bytes;
        let magic = read_u32(&mut cur)?;
        let ver = read_u32(&mut cur)?;
        if magic != GIDX_MAGIC || ver != GIDX_VERSION {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Invalid GIDX header",
            ));
        }
        let source_id = read_str(&mut cur)?;
        let source_label = read_str(&mut cur)?;
        let node_count = read_u32(&mut cur)?;
        let edge_count = read_u32(&mut cur)?;
        let cluster_count = read_u32(&mut cur)? as u16;
        let node_kinds = read_str_vec(&mut cur)?;
        let edge_kinds = read_str_vec(&mut cur)?;
        let out_offsets = read_u32_vec(&mut cur)?;
        let out_targets = read_u32_vec(&mut cur)?;
        let out_meta = read_u8_vec(&mut cur)?;
        let in_offsets = read_u32_vec(&mut cur)?;
        let in_targets = read_u32_vec(&mut cur)?;
        let in_meta = read_u8_vec(&mut cur)?;
        let edge_pairs = read_u32_vec(&mut cur)?;
        let node_kind_idx = read_u8_vec(&mut cur)?;
        let node_layer = read_u8_vec(&mut cur)?;
        let clusters = read_u16_vec(&mut cur)?;
        let positions = read_f32_vec(&mut cur)?;
        let keys = read_str_vec(&mut cur)?;
        let labels = read_str_vec(&mut cur)?;
        let paths = read_str_vec(&mut cur)?;
        let snippets = read_str_vec(&mut cur)?;

        Ok(Self {
            source_id,
            source_label,
            node_count,
            edge_count,
            node_kinds,
            edge_kinds,
            out_offsets,
            out_targets,
            out_meta,
            in_offsets,
            in_targets,
            in_meta,
            edge_pairs,
            node_kind_idx,
            node_layer,
            clusters,
            cluster_count,
            positions,
            keys,
            labels,
            paths,
            snippets,
        })
    }
}

fn write_str(w: &mut impl Write, s: &str) -> std::io::Result<()> {
    let b = s.as_bytes();
    w.write_all(&(b.len() as u32).to_le_bytes())?;
    w.write_all(b)
}

fn write_str_vec(w: &mut impl Write, v: &[String]) -> std::io::Result<()> {
    w.write_all(&(v.len() as u32).to_le_bytes())?;
    for s in v {
        write_str(w, s)?;
    }
    Ok(())
}

fn write_u8_slice(w: &mut impl Write, v: &[u8]) -> std::io::Result<()> {
    w.write_all(&(v.len() as u32).to_le_bytes())?;
    w.write_all(v)
}

fn write_u16_slice(w: &mut impl Write, v: &[u16]) -> std::io::Result<()> {
    w.write_all(&(v.len() as u32).to_le_bytes())?;
    for &x in v {
        w.write_all(&x.to_le_bytes())?;
    }
    Ok(())
}

fn write_u32_slice(w: &mut impl Write, v: &[u32]) -> std::io::Result<()> {
    w.write_all(&(v.len() as u32).to_le_bytes())?;
    for &x in v {
        w.write_all(&x.to_le_bytes())?;
    }
    Ok(())
}

fn write_f32_slice(w: &mut impl Write, v: &[f32]) -> std::io::Result<()> {
    w.write_all(&(v.len() as u32).to_le_bytes())?;
    for &x in v {
        w.write_all(&x.to_le_bytes())?;
    }
    Ok(())
}

fn read_u32(cur: &mut &[u8]) -> std::io::Result<u32> {
    if cur.len() < 4 {
        return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "eof u32"));
    }
    let val = u32::from_le_bytes([cur[0], cur[1], cur[2], cur[3]]);
    *cur = &cur[4..];
    Ok(val)
}

fn read_str(cur: &mut &[u8]) -> std::io::Result<String> {
    let len = read_u32(cur)? as usize;
    if cur.len() < len {
        return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "eof str"));
    }
    let s = std::str::from_utf8(&cur[..len])
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?
        .to_string();
    *cur = &cur[len..];
    Ok(s)
}

fn read_str_vec(cur: &mut &[u8]) -> std::io::Result<Vec<String>> {
    let n = read_u32(cur)? as usize;
    let mut out = Vec::with_capacity(n);
    for _ in 0..n {
        out.push(read_str(cur)?);
    }
    Ok(out)
}

fn read_u8_vec(cur: &mut &[u8]) -> std::io::Result<Vec<u8>> {
    let n = read_u32(cur)? as usize;
    if cur.len() < n {
        return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "eof u8"));
    }
    let out = cur[..n].to_vec();
    *cur = &cur[n..];
    Ok(out)
}

fn read_u16_vec(cur: &mut &[u8]) -> std::io::Result<Vec<u16>> {
    let n = read_u32(cur)? as usize;
    let bytes = n * 2;
    if cur.len() < bytes {
        return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "eof u16"));
    }
    let mut out = Vec::with_capacity(n);
    for chunk in cur[..bytes].chunks_exact(2) {
        out.push(u16::from_le_bytes([chunk[0], chunk[1]]));
    }
    *cur = &cur[bytes..];
    Ok(out)
}

fn read_u32_vec(cur: &mut &[u8]) -> std::io::Result<Vec<u32>> {
    let n = read_u32(cur)? as usize;
    let bytes = n * 4;
    if cur.len() < bytes {
        return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "eof u32v"));
    }
    let mut out = Vec::with_capacity(n);
    for chunk in cur[..bytes].chunks_exact(4) {
        out.push(u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    *cur = &cur[bytes..];
    Ok(out)
}

fn read_f32_vec(cur: &mut &[u8]) -> std::io::Result<Vec<f32>> {
    let n = read_u32(cur)? as usize;
    let bytes = n * 4;
    if cur.len() < bytes {
        return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "eof f32v"));
    }
    let mut out = Vec::with_capacity(n);
    for chunk in cur[..bytes].chunks_exact(4) {
        out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    *cur = &cur[bytes..];
    Ok(out)
}


pub fn truncate_utf8(s: &str, max_bytes: usize) -> String {
    let clean = s.trim();
    if clean.len() <= max_bytes {
        return clean.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !clean.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &clean[..end])
}

pub fn kind_hex_color(kind: &str, fallback_idx: usize) -> String {
    let k = kind.to_ascii_lowercase();
    let hex = match k.as_str() {
        // Legal / LexO — sober, distinct cartographic palette
        "materia" => "#C89B54",                                       // Warm Brass
        "codigo" | "ley" | "statute" => "#8D78BF",                    // Muted Amethyst
        "libro" | "titulo" | "section" => "#687D9E",                  // Slate Periwinkle
        "articulo" | "article" => "#5B96C7",                          // Steel Cerulean
        "umj" | "obligacion" | "permiso" | "prohibicion" => "#C7745C",// Terracotta
        "jurisprudencia" | "judicial" | "case" | "sentencia" => "#B86072", // Dusty Crimson
        "doctrina" | "doctrinal" => "#BFB073",                        // Warm Parchment
        "administrativo" | "dictamen" => "#4E968E",                   // Muted Seafoam Teal
        "ambiental" => "#679E73",                                     // Forest Sage
        // Obsidian / Research / Riemann
        "folder" => "#9A8256",                                        // Muted Bronze
        "moc" => "#C99E52",                                           // Observatory Gold
        "file" | "note" => "#5B96C7",                                 // Steel Cerulean
        "paper" => "#6884B8",                                         // Slate Cobalt
        "author" | "person" => "#689E76",                             // Sage Olive
        "concept" | "topic" => "#9B76B5",                             // Muted Mauve
        "technique" => "#C28157",                                     // Copper Clay
        "venue" => "#6E7F91",                                         // Cool Pewter
        "tag" => "#4B948C",                                           // Deep Seafoam
        "project" | "repo" => "#C2755A",                              // Rust Sienna
        "davi" | "profile" => "#C98A55",                              // Warm Amber
        // Hermes Brain
        "skill" => "#5498B3",                                         // Calm Slate Cyan
        "plugin" => "#9474B8",                                        // Soft Indigo Plum
        "memory" => "#C4A35A",                                        // Ochre Sand
        "session" => "#5D9975",                                       // Muted Jade
        "tool" => "#B56982",                                          // Muted Rose
        "unresolved" => "#5B6978",                                    // Dark Slate
        _ => {
            const FALLBACK: [&str; 12] = [
                "#5B96C7", "#679E73", "#C89B54", "#8D78BF", "#C7745C", "#4E968E",
                "#B86072", "#BFB073", "#6884B8", "#9B76B5", "#C28157", "#748696",
            ];
            FALLBACK[fallback_idx % FALLBACK.len()]
        }
    };
    hex.to_string()
}

fn hex_to_rgba_u32(hex: &str, alpha: u8) -> u32 {
    let h = hex.trim_start_matches('#');
    if h.len() == 6 {
        let r = u8::from_str_radix(&h[0..2], 16).unwrap_or(144) as u32;
        let g = u8::from_str_radix(&h[2..4], 16).unwrap_or(164) as u32;
        let b = u8::from_str_radix(&h[4..6], 16).unwrap_or(174) as u32;
        return (r << 24) | (g << 16) | (b << 8) | (alpha as u32);
    }
    0x90A4_AEEB
}

fn derive_node_scope(source_id: &str, key: &str, path: &str, kind: &str) -> String {
    let norm_path = path.replace('\\', "/");
    if let Some(pos) = norm_path.find("/Vigente/") {
        let rest = &norm_path[pos + "/Vigente/".len()..];
        if let Some(seg) = rest.split('/').next().filter(|s| !s.is_empty()) {
            return seg.to_string();
        }
    }
    if norm_path.contains("/UMJ/") || key.starts_with("umj:") {
        return "UMJ".to_string();
    }
    for pfx in ["art:", "law:", "sec:"] {
        if let Some(rest) = key.strip_prefix(pfx) {
            if let Some(code) = rest.split(':').next().filter(|s| !s.is_empty()) {
                return code.to_string();
            }
        }
    }
    if kind.eq_ignore_ascii_case("tag") || key.starts_with("tag:") || key.starts_with('#') {
        return "#tags".to_string();
    }
    if source_id == "hermes-brain" {
        if let Some((prefix, _)) = key.split_once(':') {
            if !prefix.is_empty() {
                return prefix.to_string();
            }
        }
        return kind.to_string();
    }
    for marker in ["/Vault/", "/vault/", "/workspace/ACTIVE/", "/workspace/"] {
        if let Some(pos) = norm_path.find(marker) {
            let rest = &norm_path[pos + marker.len()..];
            let mut parts = rest.split('/').filter(|s| !s.is_empty());
            if let (Some(first), Some(_second)) = (parts.next(), parts.next()) {
                return first.to_string();
            }
        }
    }
    let clean_rel = norm_path.trim_start_matches("./").trim_start_matches('/');
    if !norm_path.starts_with('/') && clean_rel.contains('/') {
        if let Some(first) = clean_rel.split('/').next().filter(|s| !s.is_empty()) {
            return first.to_string();
        }
    }
    let key_clean = key
        .strip_prefix("file:")
        .or_else(|| key.strip_prefix("note:"))
        .or_else(|| key.strip_prefix("folder:"))
        .unwrap_or(key)
        .trim_start_matches('/');
    if key_clean.contains('/') && !key_clean.starts_with("http") {
        if let Some(first) = key_clean.split('/').next().filter(|s| !s.is_empty()) {
            return first.to_string();
        }
    }
    kind.to_string()
}

/// Extracts contextual 4-digit years (1750..=2035) from patterns like `(2018)`, `Year: 2010`,
/// `2025-04-19`, or `/2024/` while avoiding bare legal article numbers like `Art. 1950`.
fn extract_contextual_year(text: &str) -> Option<u16> {
    if text.len() < 4 {
        return None;
    }
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i + 4 <= len {
        if bytes[i].is_ascii_digit()
            && bytes[i + 1].is_ascii_digit()
            && bytes[i + 2].is_ascii_digit()
            && bytes[i + 3].is_ascii_digit()
        {
            let prev = if i > 0 { Some(bytes[i - 1]) } else { None };
            let next = if i + 4 < len { Some(bytes[i + 4]) } else { None };
            let prev_digit = prev.map_or(false, |b| b.is_ascii_digit());
            let next_digit = next.map_or(false, |b| b.is_ascii_digit());
            if !prev_digit && !next_digit {
                let contextual = matches!((prev, next), (Some(b'('), Some(b')')))
                    || matches!((prev, next), (Some(b'['), Some(b']')))
                    || matches!(next, Some(b'-') | Some(b'/')) && i + 7 <= len && bytes[i + 5].is_ascii_digit() && bytes[i + 6].is_ascii_digit()
                    || matches!((prev, next), (Some(b'/'), Some(b'/')))
                    || (i >= 6 && text[..i].to_ascii_lowercase().ends_with("year: "));
                if contextual {
                    if let Ok(s) = std::str::from_utf8(&bytes[i..i + 4]) {
                        if let Ok(yr) = s.parse::<u16>() {
                            if (1750..=2035).contains(&yr) {
                                return Some(yr);
                            }
                        }
                    }
                }
            }
            i += 4;
        } else {
            i += 1;
        }
    }
    None
}

fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((input.len() + 2) / 3) * 4);
    let mut chunks = input.chunks_exact(3);
    for c in &mut chunks {
        let n = ((c[0] as u32) << 16) | ((c[1] as u32) << 8) | (c[2] as u32);
        out.push(TABLE[((n >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 6) & 0x3F) as usize] as char);
        out.push(TABLE[(n & 0x3F) as usize] as char);
    }
    let rem = chunks.remainder();
    if rem.len() == 1 {
        let n = (rem[0] as u32) << 16;
        out.push(TABLE[((n >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3F) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rem.len() == 2 {
        let n = ((rem[0] as u32) << 16) | ((rem[1] as u32) << 8);
        out.push(TABLE[((n >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 6) & 0x3F) as usize] as char);
        out.push('=');
    }
    out
}
