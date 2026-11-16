//! Incremental native-only placement over Graphium CSR; old coordinates stay pinned.
//! Spatial-bucket refinement follows Graphium's bounded local repulsion approach.
use crate::csr::{CsrGraph, GraphBuilder};
use rayon::prelude::*;
use std::collections::HashMap;

pub fn seed(builder: &mut GraphBuilder, parents: &HashMap<u32, u32>) -> (Vec<bool>, f32) {
    let pinned: Vec<bool> = builder.nodes.iter().map(|n| n.preset_pos.is_some()).collect();
    if !pinned.iter().any(|v| *v) { return (pinned, 24.); }
    let mut lo = [f32::INFINITY; 3];
    let mut hi = [f32::NEG_INFINITY; 3];
    let mut groups: HashMap<Option<u32>, Vec<usize>> = HashMap::new();
    for (i, node) in builder.nodes.iter().enumerate() {
        if let Some(p) = node.preset_pos {
            for a in 0..3 { lo[a] = lo[a].min(p[a]); hi[a] = hi[a].max(p[a]); }
        } else {
            groups.entry(parents.get(&(i as u32)).copied()).or_default().push(i);
        }
    }
    let span = ((hi[0]-lo[0]).powi(2)+(hi[1]-lo[1]).powi(2)+(hi[2]-lo[2]).powi(2)).sqrt();
    let gap = (span / 60.).clamp(24., 160.);
    let mut group_keys: Vec<_> = groups.keys().copied().collect();
    group_keys.sort_unstable();
    // Parent chains are usually shallow. Bound work even for cyclic/untrusted input.
    for pass in 0..9 {
        for parent in &group_keys {
            let members = &groups[parent];
            let anchor = parent.and_then(|id| builder.nodes[id as usize].preset_pos);
            if parent.is_some() && anchor.is_none() && pass < 8 { continue; }
            let center = anchor.unwrap_or([0.,0.,0.]);
            let radius = gap * (members.len() as f32).sqrt().max(1.);
            for (rank, &i) in members.iter().enumerate() {
                if builder.nodes[i].preset_pos.is_some() { continue; }
                let z = 1. - 2. * (rank as f32 + 0.5) / members.len() as f32;
                let angle = rank as f32 * std::f32::consts::PI * (3. - 5.0f32.sqrt());
                let radial = (1. - z*z).max(0.).sqrt();
                let unit = [radial*angle.cos(), radial*angle.sin(), z];
                builder.nodes[i].preset_pos = Some(std::array::from_fn(|a| (center[a]+radius*unit[a]).clamp(-10_000_000.,10_000_000.)));
            }
        }
        // No progress may mean a cycle, not completion. Keep the final
        // forced pass reachable so build() never discards existing pins.
        if builder.nodes.iter().all(|node| node.preset_pos.is_some()) { break; }
    }
    (pinned, gap)
}

pub fn relax(graph: &mut CsrGraph, pinned: &[bool], gap: f32) {
    if !pinned.iter().any(|v| *v) || pinned.iter().all(|v| *v) { return; }
    let n = graph.node_count as usize;
    let iterations = if n <= 25_000 { 16 } else { 8 };
    let cell_size = gap * 1.5;
    for step in 0..iterations {
        let mut buckets: HashMap<(i32,i32,i32), Vec<usize>> = HashMap::new();
        for i in 0..n {
            let p = &graph.positions[i*3..i*3+3];
            buckets.entry(((p[0]/cell_size).floor() as i32,(p[1]/cell_size).floor() as i32,(p[2]/cell_size).floor() as i32)).or_default().push(i);
        }
        let positions = &graph.positions;
        let limit = gap * 0.35 * (1. - step as f32 / iterations as f32 * 0.7);
        let deltas: Vec<[f32;3]> = (0..n).into_par_iter().map(|i| {
            if pinned[i] { return [0.;3]; }
            let p = [positions[i*3],positions[i*3+1],positions[i*3+2]];
            let key = ((p[0]/cell_size).floor() as i32,(p[1]/cell_size).floor() as i32,(p[2]/cell_size).floor() as i32);
            let mut force = [0.;3];
            for x in -1..=1 { for y in -1..=1 { for z in -1..=1 {
                if let Some(bucket) = buckets.get(&(key.0+x,key.1+y,key.2+z)) {
                    for &j in bucket.iter().take(32) {
                        if i == j { continue; }
                        let delta: [f32;3] = std::array::from_fn(|a| p[a]-positions[j*3+a]);
                        let distance = delta.iter().map(|v| v*v).sum::<f32>().sqrt();
                        if distance < 0.001 { force[(i+j)%3] += if i > j { gap*0.1 } else { -gap*0.1 }; }
                        else if distance < gap { for a in 0..3 { force[a] += delta[a]/distance*(gap-distance)*0.4; } }
                    }
                }
            } } }
            let (out, _) = graph.out_neighbors(i as u32);
            let (incoming, _) = graph.in_neighbors(i as u32);
            for &j in out.iter().chain(incoming.iter()).take(48) {
                let j = j as usize;
                let delta: [f32;3] = std::array::from_fn(|a| positions[j*3+a]-p[a]);
                let distance = delta.iter().map(|v| v*v).sum::<f32>().sqrt().max(0.001);
                let rest = gap * (graph.total_degree(j as u32) as f32).sqrt().clamp(1.,30.);
                for a in 0..3 { force[a] += delta[a]/distance*(distance-rest)*0.025; }
            }
            let magnitude = force.iter().map(|v| v*v).sum::<f32>().sqrt();
            if magnitude > limit { for value in &mut force { *value *= limit / magnitude; } }
            force
        }).collect();
        for (i, delta) in deltas.iter().enumerate() {
            if !pinned[i] { for a in 0..3 { graph.positions[i*3+a] = (graph.positions[i*3+a]+delta[a]).clamp(-10_000_000.,10_000_000.); } }
        }
    }
}
