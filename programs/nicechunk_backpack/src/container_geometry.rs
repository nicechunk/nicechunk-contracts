//! Authoritative NCF1 water capacity. Exact integer boundaries; no display-grid hole filling.
//! Exact rectilinear liquid retention for the existing component NCF1 v15.
//! Coordinates follow CURRENT forgeComponentSolidVoxelBoxesQ2, scaled to 2048/m.
//! Coordinate compression preserves every source boundary; it never seals a
//! crack by sampling a coarser display grid. +Y is up. Closed voids are excluded.

const GRID: [usize; 3] = [14, 10, 14];
const CELLS: usize = 1960;
const AXIS_CAP: usize = 63;
const NONE: u16 = u16::MAX;
type Res<T> = Result<T, u64>;

#[cfg(test)]
mod tests {
    use super::*;
    include!("container_test_vectors.rs");
    include!("container_assembly_test_vectors.rs");
    #[test]
    fn joined_materials_are_one_vessel_and_grip_has_local_ownership() {
        for &(name, hex, seed, expected) in ASSEMBLY_VECTORS {
            let code: Vec<u8>=(0..hex.len()).step_by(2).map(|i|u8::from_str_radix(&hex[i..i+2],16).unwrap()).collect();
            let report=calculate(&code,&mut vec![0;224*1024],seed).unwrap();
            assert_eq!(if report.water.status==0 {report.water.volume_q3} else {0},expected,"{}: status {}",name,report.water.status);
        }
    }

    #[test]
    fn actual_ncf1_cavities_and_rejections_match_client_vectors() {
        for &(name, hex, seed, expected) in VECTORS {
            let code: Vec<u8> = (0..hex.len()).step_by(2).map(|i|u8::from_str_radix(&hex[i..i+2],16).unwrap()).collect();
            let mut scratch=vec![0;224*1024];
            let report=calculate(&code,&mut scratch,seed).unwrap();
            assert_eq!(if report.water.status==0 {report.water.volume_q3} else {0},expected,"{}",name);
        }
    }
    #[test]
    fn malformed_geometry_and_out_of_range_seed_fail_closed() {
        assert!(calculate(&[0;14],&mut vec![0;224*1024],130).is_err());
        let hex=VECTORS[0].1;
        let code: Vec<u8>=(0..hex.len()).step_by(2).map(|i|u8::from_str_radix(&hex[i..i+2],16).unwrap()).collect();
        assert!(calculate(&code,&mut vec![0;224*1024],0xf000).is_err());
        assert!(calculate(&code,&mut [0;8],130).is_err());
    }
    #[test]
    fn capacity_metadata_preserves_v1_identity_and_immutable_model() {
        use crate::state::{ForgedItemAccount,ForgedItemInitArgs,verified_forge_design};
        use solana_program::pubkey::Pubkey;
        let hex=VECTORS[0].1;
        let code:Vec<u8>=(0..hex.len()).step_by(2).map(|i|u8::from_str_radix(&hex[i..i+2],16).unwrap()).collect();
        let mut data=vec![0;ForgedItemAccount::LEN];
        ForgedItemAccount::pack(&mut data,&ForgedItemInitArgs {bump:1,item_id:42,creator:&Pubkey::new_unique(),origin_backpack:&Pubkey::new_unique(),design_hash:verified_forge_design(&code).unwrap().0,code:&code,created_slot:99,created_at:123}).unwrap();
        let before=data.clone();
        assert_eq!(ForgedItemAccount::water_capacity_ml(&data).unwrap(),0);
        ForgedItemAccount::certify_water_capacity(&mut data,360,VECTORS[0].2).unwrap();
        ForgedItemAccount::certify_water_capacity(&mut data,100,0).unwrap();
        assert_eq!(ForgedItemAccount::water_capacity_ml(&data).unwrap(),360);
        assert_eq!(&data[..90],&before[..90]);assert_eq!(&data[96..],&before[96..]);
        assert!(ForgedItemAccount::certify_water_capacity(&mut data,500,0xf000).is_err());
    }
}

#[inline(always)]
fn remaining() -> u64 { 0 }

pub struct WaterReport {
    pub status: u32,
    pub cavity_cells: u32,
    pub volume_q3: u64,
    pub opening_area_q2: u64,
    pub mouth_y: i64,
}
impl WaterReport {
    fn empty() -> Self { Self { status: 0, cavity_cells: 0, volume_q3: 0, opening_area_q2: 0, mouth_y: 0 } }
    fn rejected(status: u32) -> Self { Self { status, ..Self::empty() } }
}

pub struct Report {
    pub capacity_q3: u64,
    pub material_q3: u64,
    pub dims: [usize; 3],
    pub visited: u32,
    pub retained: u32,
    pub scratch_bytes: u32,
    pub components: u32,
    pub capacity_mm3: u64,
    pub water: WaterReport,
    pub phase_cu: [u64; 4],
}

impl Report {
    pub fn to_water_bytes(&self) -> [u8; 120] {
        let mut out = [0_u8; 120];
        out[..56].copy_from_slice(&self.to_bytes());
        out[56..60].copy_from_slice(&self.water.status.to_le_bytes());
        out[60..64].copy_from_slice(&self.water.cavity_cells.to_le_bytes());
        out[64..72].copy_from_slice(&self.water.volume_q3.to_le_bytes());
        out[72..80].copy_from_slice(&self.water.opening_area_q2.to_le_bytes());
        out[80..88].copy_from_slice(&self.water.mouth_y.to_le_bytes());
        for i in 0..4 { out[88+i*8..96+i*8].copy_from_slice(&self.phase_cu[i].to_le_bytes()); }
        out
    }
    pub fn to_bytes(&self) -> [u8; 56] {
        let mut out = [0_u8; 56];
        out[0..8].copy_from_slice(&self.capacity_q3.to_le_bytes());
        out[8..16].copy_from_slice(&self.material_q3.to_le_bytes());
        for axis in 0..3 {
            out[16 + axis * 4..20 + axis * 4].copy_from_slice(&(self.dims[axis] as u32).to_le_bytes());
        }
        out[28..32].copy_from_slice(&self.visited.to_le_bytes());
        out[32..36].copy_from_slice(&self.retained.to_le_bytes());
        out[36..40].copy_from_slice(&self.scratch_bytes.to_le_bytes());
        out[40..44].copy_from_slice(&self.components.to_le_bytes());
        out[48..56].copy_from_slice(&self.capacity_mm3.to_le_bytes());
        out
    }
}

struct Bits<'a> { data: &'a [u8], bit: usize }
impl<'a> Bits<'a> {
    fn read(&mut self, mut bits: usize) -> Res<u32> {
        if bits > 32 || self.bit + bits > self.data.len() * 8 { return Err(3); }
        let mut out = 0_u32;
        while bits > 0 {
            let available = 8 - self.bit % 8;
            let take = bits.min(available);
            let shift = available - take;
            let mask = (1_u32 << take) - 1;
            out = (out << take) | ((self.data[self.bit / 8] as u32 >> shift) & mask);
            self.bit += take;
            bits -= take;
        }
        Ok(out)
    }
    fn skip(&mut self, bits: usize) -> Res<()> {
        if self.bit + bits > self.data.len() * 8 { return Err(3); }
        self.bit += bits;
        Ok(())
    }
    fn header(data: &'a [u8]) -> Res<(Self, usize)> {
        if !(14..=640).contains(&data.len()) { return Err(3); }
        let mut reader = Self { data, bit: 0 };
        if reader.read(4)? != 15 { return Err(4); }
        if reader.read(16)? == 0 || reader.read(16)? & 8191 == 0 { return Err(3); }
        reader.skip(72)?;
        if reader.read(1)? != 0 { return Err(4); } // Appearance mode is not a solid model.
        let count = reader.read(5)? as usize;
        if count == 0 || count > 24 { return Err(4); }
        Ok((reader, count))
    }
    fn finish(&mut self) -> Res<()> {
        let remainder = self.data.len() * 8 - self.bit;
        if remainder > 7 || self.read(remainder)? != 0 { return Err(3); }
        Ok(())
    }
}

struct Component { dims: [i32; 3], offset: [i32; 3], full: bool, grip: Option<Grip> }

#[derive(Clone, Copy)]
struct Grip { point: [i32; 3], axis: usize, sign: i32, rotation: usize }
fn read_component(reader: &mut Bits, solid: &mut [u8]) -> Res<Component> {
    let resource = reader.read(3)?;
    if resource > 4 { return Err(4); } // Deformable cloth does not certify as a rigid water vessel.
    if reader.read(1)? == 0 { reader.skip(12)?; }
    let mut dims = [0_i32; 3];
    for item in &mut dims { *item = reader.read(8)? as i32; if *item == 0 { return Err(3); } }
    let mut offset = [0_i32; 3];
    if reader.read(1)? == 0 {
        for item in &mut offset {
            let value = reader.read(10)? as i32;
            *item = if value >= 512 { value - 1024 } else { value };
        }
    }
    let grip = if reader.read(1)? != 0 {
        let mut point = [0_i32; 3];
        for axis in 0..3 {
            let v = reader.read(10)? as i32;
            point[axis] = (offset[axis] + if v >= 512 { v-1024 } else { v }) * 32;
        }
        let packed = reader.read(3)?;
        if packed >> 1 > 2 { return Err(3); }
        let rotation = reader.read(2)? as usize;
        Some(Grip { point, axis: (packed >> 1) as usize, sign: if packed&1 != 0 {1} else {-1}, rotation })
    } else { None };
    let mode = reader.read(2)?;
    match mode {
        0 => read_runs(reader, solid, 11)?,
        1 => solid.fill(1),
        2 => {
            solid.fill(1);
            let count = reader.read(5)? as usize;
            if count == 0 { return Err(3); }
            for _ in 0..count {
                let mut b = [0_usize; 6];
                for value in &mut b { *value = reader.read(4)? as usize; }
                for axis in 0..3 { if b[axis+3] == 0 || b[axis] + b[axis+3] > GRID[axis] { return Err(3); } }
                for z in b[2]..b[2]+b[5] { for y in b[1]..b[1]+b[4] { for x in b[0]..b[0]+b[3] {
                    let index = x + 14 * (y + 10 * z);
                    if solid[index] == 0 { return Err(3); }
                    solid[index] = 0;
                } } }
            }
        }
        3 => {
            let axis = reader.read(2)? as usize;
            if axis > 2 { return Err(3); }
            let tangent = match axis { 0 => [1,2], 1 => [0,2], _ => [0,1] };
            let width = GRID[tangent[0]];
            let mut mask = [0_u8; 196];
            read_runs(reader, &mut mask[..width*GRID[tangent[1]]], 8)?;
            for z in 0..14 { for y in 0..10 { for x in 0..14 {
                let p = [x,y,z];
                solid[x + 14*(y+10*z)] = mask[p[tangent[0]] + width*p[tangent[1]]];
            } } }
        }
        _ => return Err(3),
    }
    if !solid.iter().any(|&v| v != 0) { return Err(3); }
    let paint_count = reader.read(11)? as usize;
    // Paint does not change material occupancy; its fixed-width records must
    // still be entirely present before the next component is interpreted.
    reader.skip(paint_count * 35)?;
    Ok(Component { dims, offset, full: mode == 1, grip })
}

fn read_runs(reader: &mut Bits, out: &mut [u8], bits: usize) -> Res<()> {
    let mut value = reader.read(1)? as u8;
    let count = reader.read(bits)? as usize;
    if count == 0 { return Err(3); }
    let mut cursor = 0;
    for _ in 0..count {
        let len = reader.read(bits)? as usize;
        if len == 0 || cursor + len > out.len() { return Err(3); }
        out[cursor..cursor+len].fill(value);
        value ^= 1;
        cursor += len;
    }
    if cursor != out.len() { return Err(3); }
    Ok(())
}

struct Axis { values: [i16; AXIS_CAP], len: usize }
impl Axis {
    fn new() -> Self { Self { values: [0; AXIS_CAP], len: 0 } }
    fn add(&mut self, coordinate: i16) -> Res<()> {
        let mut at = 0;
        while at < self.len && self.values[at] < coordinate { at += 1; }
        if at < self.len && self.values[at] == coordinate { return Ok(()); }
        if self.len == AXIS_CAP { return Err(5); }
        for i in (at..self.len).rev() { self.values[i+1] = self.values[i]; }
        self.values[at] = coordinate;
        self.len += 1;
        Ok(())
    }
    fn position(&self, value: i16) -> Res<usize> {
        self.values[..self.len].binary_search(&value).map_err(|_| 6)
    }
    fn floor_position(&self, value: i16) -> usize {
        match self.values[..self.len].binary_search(&value) {
            Ok(index) => index,
            Err(index) => index.saturating_sub(1),
        }
    }
    #[inline(always)]
    fn width(&self, index: usize) -> u64 { (self.values[index+1] - self.values[index]) as u64 }
}

#[inline(always)]
fn boundary(component: &Component, axis: usize, cell: usize) -> i16 {
    let n = GRID[axis] as i32;
    // Math.round(positive_value), exactly as the current JS Q2 geometry.
    (component.offset[axis]*32 - component.dims[axis]*16
        + (cell as i32 * component.dims[axis]*32 + n/2) / n) as i16
}

// An internal source plane is unnecessary iff no solid/empty transition occurs
// anywhere across it. Removing just these planes is exact, unlike sampling.
// Axis masks remain at most 15 bits and retain all real cavity/crack boundaries.
fn transition_planes(solid: &[u8]) -> [u16;3] {
    let mut rows=[0_u16;140];
    let mut planes=[0_u16;3];
    for row in 0..140 {
        let mut mask=0_u16;
        for x in 0..14 {mask |= (solid[row*14+x] as u16)<<x;}
        rows[row]=mask;
        planes[0] |= mask ^ (mask<<1);
    }
    for z in 0..14 {for y in 0..10 {
        let r=rows[y+10*z];
        if r != (if y==0 {0} else {rows[y-1+10*z]}) {planes[1]|=1<<y;}
        if y==9 && r!=0 {planes[1]|=1<<10;}
        if r != (if z==0 {0} else {rows[y+10*(z-1)]}) {planes[2]|=1<<z;}
        if z==13 && r!=0 {planes[2]|=1<<14;}
    }}
    planes
}

pub fn calculate(code: &[u8], scratch: &mut [u8], seed_index: u16) -> Res<Report> {
    if scratch.len()<CELLS || seed_index&0xf000!=0 {return Err(7);}
    let start_cu = remaining();
    let mut grip = None;
    let mut grip_count = 0;
    let (solid, rest) = scratch.split_at_mut(CELLS);
    let mut axes = [Axis::new(), Axis::new(), Axis::new()];
    let is_appearance = code.len() >= 14 && code[13]&8 != 0;
    let count;
    if is_appearance {
        let (mut reader, header) = appearance_header(code)?;
        grip = header.grip;
        grip_count = if grip.is_some() {1} else {0};
        count = 0;
        for _ in 0..header.count {
            let q = read_appearance_quad(&mut reader,&header)?;
            let tangent = tangents(q.axis);
            axes[q.axis].add(appearance_boundary(header.dims[q.axis],q.plane))?;
            axes[tangent[0]].add(appearance_boundary(header.dims[tangent[0]],q.low[0]))?;
            axes[tangent[0]].add(appearance_boundary(header.dims[tangent[0]],q.high[0]))?;
            axes[tangent[1]].add(appearance_boundary(header.dims[tangent[1]],q.low[1]))?;
            axes[tangent[1]].add(appearance_boundary(header.dims[tangent[1]],q.high[1]))?;
        }
        reader.finish()?;
    } else {
    let (mut reader, component_count) = Bits::header(code)?;
    count = component_count;
    for _ in 0..count {
        let component = read_component(&mut reader, solid)?;
        if component.grip.is_some() { grip = component.grip; grip_count += 1; }
        let planes = if component.full { [0;3] } else { transition_planes(solid) };
        for axis in 0..3 {
            if component.full {
                axes[axis].add(boundary(&component, axis, 0))?;
                axes[axis].add(boundary(&component, axis, GRID[axis]))?;
            } else {
                for cell in 0..=GRID[axis] {
                    if planes[axis] & (1 << cell) != 0 { axes[axis].add(boundary(&component, axis, cell))?; }
                }
            }
        }
    }
    reader.finish()?;
    }
    for axis in &mut axes {
        let low = axis.values[0] - 1;
        let high = axis.values[axis.len-1] + 1;
        axis.add(low)?;
        axis.add(high)?;
    }
    let dims = [axes[0].len-1, axes[1].len-1, axes[2].len-1];
    let seed_x = (seed_index & 63) as usize;
    let seed_z = ((seed_index >> 6) & 63) as usize;
    if seed_index & 0xf000 != 0 || seed_x >= dims[0] || seed_z >= dims[2] { return Err(3); }
    let seed = Some([
        axes[0].values[seed_x] as i32 + (axes[0].width(seed_x)/2) as i32,
        axes[2].values[seed_z] as i32 + (axes[2].width(seed_z)/2) as i32]);
    let after_axes = remaining();
    let total = dims[0]*dims[1]*dims[2];
    if total >= NONE as usize { return Err(5); }
    let bytes = (total+7)/8;
    let cert_extra = if seed.is_some() { (dims[0]*dims[2]+7)/8+bytes } else {0};
    let face_extra = if is_appearance {
        (dims[0]+1)*dims[1]*dims[2]+dims[0]*(dims[1]+1)*dims[2]+dims[0]*dims[1]*(dims[2]+1)
    } else {0};
    let queue_pad = bytes & 1;
    let required = CELLS + bytes*3 + queue_pad + total*2 + cert_extra.max(face_extra);
    if required > scratch_len(rest) + CELLS { return Err(7); }
    let (material, rest) = rest.split_at_mut(bytes);
    let (visited, rest) = rest.split_at_mut(bytes);
    let (grip_material, rest) = rest.split_at_mut(bytes);
    grip_material.fill(0);
    // The packed bitsets can leave an odd queue address. Reserve one byte
    // when needed so u16 queue accesses remain aligned.
    let rest = &mut rest[queue_pad..];
    let next = unsafe { core::slice::from_raw_parts_mut(rest.as_mut_ptr().cast::<u16>(), total) };
    material.fill(0);
    if is_appearance {
        rebuild_appearance(code,material,dims,&axes,&mut rest[total*2..])?;
        grip_material.copy_from_slice(material);
    } else {
    let (mut reader, _) = Bits::header(code)?;
    for _ in 0..count {
        let component = read_component(&mut reader, solid)?;
        if component.full {
            let low = [axes[0].position(boundary(&component,0,0))?, axes[1].position(boundary(&component,1,0))?, axes[2].position(boundary(&component,2,0))?];
            let high = [axes[0].position(boundary(&component,0,14))?, axes[1].position(boundary(&component,1,10))?, axes[2].position(boundary(&component,2,14))?];
            fill_box(material, grip_material, component.grip.is_some(), dims, low, high);
            continue;
        }
        let mut positions = [[0_usize; 15]; 3];
        for axis in 0..3 { for cell in 0..=GRID[axis] {
            positions[axis][cell] = axes[axis].floor_position(boundary(&component,axis,cell));
        } }
        let planes = transition_planes(solid);
        let mut cuts = [[0_usize;15];3];
        let mut sizes = [0_usize;3];
        for a in 0..3 {for p in 0..=GRID[a] {
            if planes[a] & (1<<p) != 0 {cuts[a][sizes[a]]=p;sizes[a]+=1;}
        }}
        for zi in 0..sizes[2].saturating_sub(1) {for yi in 0..sizes[1].saturating_sub(1) {
            for xi in 0..sizes[0].saturating_sub(1) {
                let x=cuts[0][xi];let y=cuts[1][yi];let z=cuts[2][zi];
                if solid[x+14*(y+10*z)] == 0 {continue;}
                fill_box(material,grip_material,component.grip.is_some(),dims,[positions[0][x],positions[1][y],positions[2][z]],
                    [positions[0][cuts[0][xi+1]],positions[1][cuts[1][yi+1]],positions[2][cuts[2][zi+1]]]);
            }
        }}
    }
    }
    let after_rebuild = remaining();
    let water = if let Some(seed) = seed {
        let extra = &mut rest[total*2..];
        certify(material, grip_material, dims, &axes, grip, grip_count, seed, visited, next, extra)?
    } else { WaterReport::empty() };
    let after_cert = remaining();
    let [nx,ny,nz] = dims;
    let mut material_q3 = 0_u64;
    for z in 0..nz { for y in 0..ny { for x in 0..nx {
        if bit(material,x+nx*(y+ny*z)) {
            material_q3 += axes[0].width(x)*axes[1].width(y)*axes[2].width(z);
        }
    } } }
    let capacity_q3 = if water.status == 0 { water.volume_q3 } else { 0 };
    let popped = water.cavity_cells;
    let retained = water.cavity_cells;
    // chunk.js defines dimensions in Q6 metres; Q2 positions are 1/128 metre.
    // Round DOWN once, after summing exact integer geometry volumes.
    let capacity_mm3 = ((capacity_q3 as u128 * 1_000_000_000) / 8_589_934_592) as u64;
    Ok(Report { capacity_q3, material_q3, dims, visited: popped, retained,
        scratch_bytes: required as u32, components: count as u32, capacity_mm3, water,
        phase_cu: [start_cu-after_axes, after_axes-after_rebuild, after_rebuild-after_cert, after_cert-remaining()] })
}

#[inline(always)]
fn scratch_len(scratch: &[u8]) -> usize { scratch.len() }

#[inline(always)]
fn bit(bytes: &[u8], index: usize) -> bool { bytes[index>>3] & (1 << (index&7)) != 0 }


fn fill_box(material: &mut [u8], grip_material: &mut [u8], grip_owner: bool, dims: [usize;3], low: [usize;3], high: [usize;3]) {
    for z in low[2]..high[2] { for y in low[1]..high[1] { for x in low[0]..high[0] {
        let index = x+dims[0]*(y+dims[1]*z);
        material[index>>3] |= 1 << (index&7);
        if grip_owner { grip_material[index>>3] |= 1 << (index&7); }
    } } }
}

// Certification scope: one +Y, sky-visible mouth, inferred from an
// enclosed horizontal section. The client supplies only an X/Z cavity seed,
// never a lid polygon or a capacity. The exact patch must have a real solid rim.
// This accepts nonrectangular sections and stepped rims, but is not a complete
// recognizer for all multiple-mouth or bent-neck NCF1 constructions.
fn certify(
    material: &[u8], grip_material: &[u8], dims: [usize;3], axes: &[Axis;3], grip: Option<Grip>,
    grip_count: u32, seed: [i32;2], seen: &mut [u8], queue: &mut [u16], extra: &mut [u8],
) -> Res<WaterReport> {
    if grip_count != 1 { return Ok(WaterReport::rejected(if grip_count == 0 {10} else {11})); }
    let grip = grip.unwrap();
    let [nx,ny,nz] = dims;
    let plane_bytes = (nx*nz+7)/8;
    let grid_bytes = (nx*ny*nz+7)/8;
    if extra.len() < plane_bytes + grid_bytes { return Err(7); }
    let (opening, material_seen) = extra.split_at_mut(plane_bytes);
    let material_seen = &mut material_seen[..grid_bytes];
    let point = grip.point;
    let axis = grip.axis;
    let tangent = match axis {0=>[1,2],1=>[0,2],_=>[0,1]};
    // Integer palm rectangle: 8 x 10 cm, rounded down on the existing lattice.
    // The production avatar-body collision and component-specific fit policy
    // remain outside this isolated geometry experiment.
    let palm = if grip.rotation&1 == 0 {[163_i32,204_i32]} else {[204,163]};
    let strides = [1,nx,nx*ny];
    let mut grip_cell = None;
    let mut contact = 0_u64;
    let mut min_span = [i32::MAX;2];
    let mut max_span = [i32::MIN;2];
    let mut surface_area = 0_u64;
    // Only an exposed face within half of one NCF1 Q6 anchor step is eligible.
    for z in 0..nz { for y in 0..ny { for x in 0..nx {
        let p = [x,y,z];
        let index = x+nx*(y+ny*z);
        // Source binding chooses the grip component. Other coplanar parts
        // cannot enlarge that grip, but the full union still blocks exposure.
        if !bit(grip_material,index) { continue; }
        let face = p[axis] + if grip.sign > 0 {1} else {0};
        if (axes[axis].values[face] as i32-point[axis]).abs() > 16 { continue; }
        let outside = if grip.sign > 0 {p[axis]+1 == dims[axis]} else {p[axis] == 0};
        let neighbor = if grip.sign > 0 {index+strides[axis]} else {index.saturating_sub(strides[axis])};
        if !outside && bit(material,neighbor) { continue; }
        let mut lengths = [0_i32;2];
        for t in 0..2 {
            let a = tangent[t];
            let lo = axes[a].values[p[a]] as i32;
            let hi = axes[a].values[p[a]+1] as i32;
            min_span[t] = min_span[t].min(lo);
            max_span[t] = max_span[t].max(hi);
            let half = palm[t]/2;
            lengths[t] = (hi.min(point[a]+half) - lo.max(point[a]-half)).max(0);
        }
        surface_area += axes[tangent[0]].width(p[tangent[0]])*axes[tangent[1]].width(p[tangent[1]]);
        if lengths[0] > 0 && lengths[1] > 0 {
            contact += (lengths[0]*lengths[1]) as u64;
            grip_cell = Some(index);
        }
    } } }
    if grip_cell.is_none() { return Ok(WaterReport::rejected(12)); }
    let reference = surface_area.min((palm[0]*palm[1]) as u64);
    if contact*1_000_000 < 25*2048*2048 || contact*100 < reference*18 {
        return Ok(WaterReport::rejected(16));
    }
    if (max_span[0]-min_span[0]).min(max_span[1]-min_span[1]) > 205 {
        return Ok(WaterReport::rejected(17));
    }
    if seed[0] < axes[0].values[0] as i32 || seed[0] >= axes[0].values[nx] as i32
        || seed[1] < axes[2].values[0] as i32 || seed[1] >= axes[2].values[nz] as i32 {
        return Ok(WaterReport::rejected(13));
    }
    let sx = axes[0].floor_position(seed[0] as i16);
    let sz = axes[2].floor_position(seed[1] as i16);
    let mut mouth = None;
    for y in (0..ny-1).rev() {
        if bit(material,sx+nx*(y+ny*sz)) { break; } // A roof blocks a top mouth.
        opening.fill(0);
        let mut head = 0;
        let mut tail = 0;
        enqueue(sx+nx*sz,opening,queue,&mut tail);
        let mut bounded = true;
        while head < tail {
            let index = queue[head] as usize; head += 1;
            let x = index%nx; let z = index/nx;
            if x == 0 || x+1 == nx || z == 0 || z+1 == nz { bounded = false; }
            if x > 0 && !bit(material,x-1+nx*(y+ny*z)) { enqueue(index-1,opening,queue,&mut tail); }
            if x+1 < nx && !bit(material,x+1+nx*(y+ny*z)) { enqueue(index+1,opening,queue,&mut tail); }
            if z > 0 && !bit(material,x+nx*(y+ny*(z-1))) { enqueue(index-nx,opening,queue,&mut tail); }
            if z+1 < nz && !bit(material,x+nx*(y+ny*(z+1))) { enqueue(index+nx,opening,queue,&mut tail); }
        }
        if !bounded { continue; }
        // A cap cannot hide a roof: every patch column must open to the sky.
        let mut visible = true;
        for z in 0..nz { for x in 0..nx {
            if bit(opening,x+nx*z) {
                for top in y+1..ny { if bit(material,x+nx*(top+ny*z)) { visible = false; } }
            }
        } }
        if visible { mouth = Some(y); break; }
    }
    let Some(mouth) = mouth else { return Ok(WaterReport::rejected(13)); };
    seen.fill(0);
    let mut head = 0;
    let mut tail = 0;
    enqueue(sx+nx*(mouth+ny*sz),seen,queue,&mut tail);
    let mut volume = 0_u64;
    let mut area = 0_u64;
    for z in 0..nz { for x in 0..nx {
        if bit(opening,x+nx*z) { area += axes[0].width(x)*axes[2].width(z); }
    } }
    while head < tail {
        let index = queue[head] as usize; head += 1;
        let x = index%nx; let yz = index/nx; let y = yz%ny; let z = yz/ny;
        if x == 0 || x+1 == nx || y == 0 || y+1 == ny || z == 0 || z+1 == nz {
            return Ok(WaterReport::rejected(14)); // Side/bottom/unreported outlet.
        }
        volume += axes[0].width(x)*axes[1].width(y)*axes[2].width(z);
        for delta in [-(nx as isize),nx as isize,-1,1,-((nx*ny) as isize),(nx*ny) as isize] {
            let next = (index as isize+delta) as usize;
            let crosses_cap = ((delta == nx as isize && y == mouth)
                || (delta == -(nx as isize) && y == mouth+1)) && bit(opening,x+nx*z);
            if !crosses_cap && !bit(material,next) { enqueue(next,seen,queue,&mut tail); }
        }
    }
    let cavity_cells = tail as u32;
    // Grip and all boundary walls must be in one face-connected material body.
    material_seen.fill(0); head = 0; tail = 0;
    enqueue(grip_cell.unwrap(),material_seen,queue,&mut tail);
    while head < tail {
        let index = queue[head] as usize; head += 1;
        let x=index%nx; let yz=index/nx; let y=yz%ny; let z=yz/ny;
        if x>0 && bit(material,index-1) {enqueue(index-1,material_seen,queue,&mut tail);}
        if x+1<nx && bit(material,index+1) {enqueue(index+1,material_seen,queue,&mut tail);}
        if y>0 && bit(material,index-nx) {enqueue(index-nx,material_seen,queue,&mut tail);}
        if y+1<ny && bit(material,index+nx) {enqueue(index+nx,material_seen,queue,&mut tail);}
        if z>0 && bit(material,index-nx*ny) {enqueue(index-nx*ny,material_seen,queue,&mut tail);}
        if z+1<nz && bit(material,index+nx*ny) {enqueue(index+nx*ny,material_seen,queue,&mut tail);}
    }
    for index in 0..nx*ny*nz {
        if !bit(seen,index) { continue; }
        for delta in [-(nx as isize),nx as isize,-1,1,-((nx*ny) as isize),(nx*ny) as isize] {
            let neighbor=(index as isize+delta) as usize;
            if bit(material,neighbor) && !bit(material_seen,neighbor) { return Ok(WaterReport::rejected(15)); }
        }
    }
    Ok(WaterReport { status: 0, cavity_cells, volume_q3: volume, opening_area_q2: area,
        mouth_y: axes[1].values[mouth+1] as i64 })
}

#[inline(always)]
fn enqueue(index: usize, seen: &mut [u8], queue: &mut [u16], tail: &mut usize) {
    if bit(seen,index) {return;}
    seen[index>>3] |= 1 << (index&7);
    queue[*tail]=index as u16;
    *tail+=1;
}

struct AppearanceHeader {
    dims: [i32;3], grip: Option<Grip>, count: usize, palette: [u8;25], palette_len: usize,
}
struct Quad { axis: usize, side: u8, plane: usize, low: [usize;2], high: [usize;2] }

fn tangents(axis: usize) -> [usize;2] { match axis {0=>[1,2],1=>[0,2],_=>[0,1]} }

fn appearance_boundary(dim: i32, coordinate: usize) -> i16 {
    // Unified Q11 physical lattice; the renderer uses this same rule.
    (-dim*16+(coordinate as i32*dim*32+12)/24) as i16
}

fn appearance_header(code: &[u8]) -> Res<(Bits<'_>,AppearanceHeader)> {
    if !(14..=640).contains(&code.len()) { return Err(3); }
    let mut r=Bits {data:code,bit:0};
    if r.read(4)? != 15 {return Err(4);}
    if r.read(16)? == 0 || r.read(16)?&8191 == 0 {return Err(3);}
    r.skip(72)?;
    if r.read(1)? != 1 {return Err(4);}
    let mut dims=[0;3];
    for d in &mut dims { *d=r.read(9)? as i32*2; if *d==0 {return Err(3);} }
    let grip=if r.read(1)?!=0 {
        let mut point=[0;3];
        for p in &mut point {let v=r.read(11)? as i32;*p=(if v>=1024 {v-2048} else {v})*32;}
        let packed=r.read(3)?;
        if packed>>1>2 {return Err(3);}
        Some(Grip {point,axis:(packed>>1) as usize,sign:if packed&1==1 {1} else {-1},rotation:r.read(2)? as usize})
    } else {None};
    let count=r.read(12)? as usize;
    if count==0 {return Err(3);}
    let mut palette=[0_u8;25];
    let palette_len=if r.read(1)?!=0 {
        let n=r.read(5)? as usize;
        if n==0||n>25 {return Err(3);}
        for i in 0..n {
            palette[i]=r.read(5)? as u8;
            if palette[i]>24 || (i>0 && palette[i]<=palette[i-1]) {return Err(3);}
        }
        n
    } else {0};
    Ok((r,AppearanceHeader {dims,grip,count,palette,palette_len}))
}

fn appearance_coord(r: &mut Bits,h: &AppearanceHeader) -> Res<usize> {
    if h.palette_len==0 {
        let v=r.read(5)? as usize;
        return if v<=24 {Ok(v)} else {Err(3)};
    }
    let width=if h.palette_len<=1 {1} else {usize::BITS-(h.palette_len-1).leading_zeros()};
    let index=r.read(width as usize)? as usize;
    if index>=h.palette_len {return Err(3);}
    Ok(h.palette[index] as usize)
}

fn read_appearance_quad(r: &mut Bits,h: &AppearanceHeader) -> Res<Quad> {
    let partial=r.read(1)?!=0;
    let general=if partial {r.read(1)?!=0} else {false};
    let axis=r.read(2)? as usize;
    let side=r.read(1)? as u8;
    let resource=r.read(3)?;
    if axis>2||resource>4 {return Err(4);}
    let plane=appearance_coord(r,h)?;
    r.skip(12)?;
    let mut low=[0;2]; let mut high=[24;2];
    if partial {
        if general {
            for a in 0..2 {low[a]=appearance_coord(r,h)?;high[a]=appearance_coord(r,h)?;}
        } else {
            let a=if r.read(1)?!=0 {1} else {0};
            low[a]=appearance_coord(r,h)?;high[a]=appearance_coord(r,h)?;
        }
    }
    if low[0]>=high[0]||low[1]>=high[1] {return Err(3);}
    Ok(Quad {axis,side,plane,low,high})
}

fn face_index(dims: [usize;3],axis: usize,plane: usize,u: usize,v: usize) -> usize {
    let base=if axis==0 {0} else if axis==1 {(dims[0]+1)*dims[1]*dims[2]}
        else {(dims[0]+1)*dims[1]*dims[2]+dims[0]*(dims[1]+1)*dims[2]};
    let tangent=tangents(axis);
    base+plane+(dims[axis]+1)*(u+dims[tangent[0]]*v)
}

// Restore solid from oriented faces; do not fill its bounding box. X rays must
// enter/exit solid consistently, then every Y/Z face is checked against that
// same occupancy. Missing bottom surfaces and contradictory sheets reject.
fn rebuild_appearance(code: &[u8],material: &mut [u8],dims: [usize;3],axes: &[Axis;3],extra: &mut [u8]) -> Res<()> {
    let face_count=(dims[0]+1)*dims[1]*dims[2]+dims[0]*(dims[1]+1)*dims[2]+dims[0]*dims[1]*(dims[2]+1);
    if face_count>extra.len() {return Err(7);}
    let faces=&mut extra[..face_count];faces.fill(0);
    let (mut r,h)=appearance_header(code)?;
    for _ in 0..h.count {
        let q=read_appearance_quad(&mut r,&h)?;
        let t=tangents(q.axis);
        let plane=axes[q.axis].position(appearance_boundary(h.dims[q.axis],q.plane))?;
        let low=[axes[t[0]].position(appearance_boundary(h.dims[t[0]],q.low[0]))?,axes[t[1]].position(appearance_boundary(h.dims[t[1]],q.low[1]))?];
        let high=[axes[t[0]].position(appearance_boundary(h.dims[t[0]],q.high[0]))?,axes[t[1]].position(appearance_boundary(h.dims[t[1]],q.high[1]))?];
        for v in low[1]..high[1] {for u in low[0]..high[0] {
            let i=face_index(dims,q.axis,plane,u,v);
            if faces[i]!=0 {return Err(20);}
            faces[i]=q.side+1;
        }}
    }
    r.finish()?;
    let [nx,ny,nz]=dims;
    for z in 0..nz {for y in 0..ny {
        let mut inside=false;
        for x in 0..=nx {
            match faces[face_index(dims,0,x,y,z)] {
                0=>{},1=>{if inside {return Err(20);} inside=true;},
                2=>{if !inside {return Err(20);} inside=false;},_=>return Err(20),
            }
            if x<nx && inside {let index=x+nx*(y+ny*z);material[index>>3]|=1<<(index&7);}
        }
        if inside {return Err(20);}
    }}
    for axis in 0..3 {
        let t=tangents(axis);
        let stride=[1,nx,nx*ny][axis];
        for v in 0..dims[t[1]] {for u in 0..dims[t[0]] {for plane in 0..=dims[axis] {
            let mut p=[0;3];p[axis]=plane;p[t[0]]=u;p[t[1]]=v;
            let index=p[0]+nx*(p[1]+ny*p[2]);
            let left=plane>0 && bit(material,index-stride);
            let right=plane<dims[axis] && bit(material,index);
            let expected=if left==right {0} else if left {2} else {1};
            if faces[face_index(dims,axis,plane,u,v)]!=expected {return Err(20);}
        }}}
    }
    Ok(())
}
