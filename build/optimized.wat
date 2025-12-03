(module
 (type $0 (func (param f32) (result f32)))
 (type $1 (func (param f32 f32) (result f32)))
 (type $2 (func (param i32 i32 i32 f32)))
 (global $~lib/math/rempio2f_y (mut f64) (f64.const 0))
 (memory $0 1)
 (data $0 (i32.const 1024) ")\15DNn\83\f9\a2\c0\dd4\f5\d1W\'\fcA\90C<\99\95b\dba\c5\bb\de\abcQ\fe")
 (export "getTerrainHeight" (func $assembly/index/getTerrainHeight))
 (export "generateTerrainMesh" (func $assembly/index/generateTerrainMesh))
 (export "memory" (memory $0))
 (func $~lib/math/NativeMathf.sin (param $0 f32) (result f32)
  (local $1 f64)
  (local $2 f64)
  (local $3 i32)
  (local $4 f64)
  (local $5 i64)
  (local $6 i32)
  (local $7 i32)
  (local $8 i64)
  (local $9 i64)
  (local $10 i32)
  (local $11 i32)
  (local $12 f64)
  (local $13 f64)
  (local $14 f64)
  (local $15 f64)
  (local $16 f64)
  (local $17 f64)
  (local $18 f64)
  (local $19 f64)
  (local $20 f64)
  (local $21 f64)
  (local $22 f64)
  (local $23 f64)
  (local $24 f64)
  (local $25 f64)
  (local $26 f64)
  (local $27 f64)
  (local $28 i32)
  (local $29 i64)
  (local $30 i32)
  (local $31 i64)
  (local $32 i64)
  (local $33 i64)
  (local $34 i32)
  (local $35 i32)
  (local $36 f64)
  (local $37 f64)
  (local $38 f64)
  (local $39 f64)
  (local $40 f64)
  (local $41 f32)
  local.get $0
  i32.reinterpret_f32
  local.tee $10
  i32.const 31
  i32.shr_u
  local.set $6
  block $folding-inner0
   local.get $10
   i32.const 2147483647
   i32.and
   local.tee $11
   i32.const 1061752794
   i32.le_u
   if
    local.get $11
    i32.const 964689920
    i32.lt_u
    if
     local.get $0
     return
    end
    local.get $0
    f64.promote_f32
    local.tee $2
    local.get $2
    f64.mul
    local.tee $1
    local.get $2
    f64.mul
    local.set $4
    br $folding-inner0
   end
   local.get $11
   i32.const 1081824209
   i32.le_u
   if
    local.get $11
    i32.const 1075235811
    i32.le_u
    if
     local.get $6
     if (result f32)
      local.get $0
      f64.promote_f32
      f64.const 1.5707963267948966
      f64.add
      local.tee $12
      local.get $12
      f64.mul
      local.tee $13
      local.get $13
      f64.mul
      local.set $14
      local.get $13
      f64.const -0.499999997251031
      f64.mul
      f64.const 1
      f64.add
      local.get $14
      f64.const 0.04166662332373906
      f64.mul
      f64.add
      local.get $14
      local.get $13
      f64.mul
      local.get $13
      f64.const 2.439044879627741e-05
      f64.mul
      f64.const -0.001388676377460993
      f64.add
      f64.mul
      f64.add
      f32.demote_f64
      f32.neg
     else
      local.get $0
      f64.promote_f32
      f64.const -1.5707963267948966
      f64.add
      local.tee $15
      local.get $15
      f64.mul
      local.tee $16
      local.get $16
      f64.mul
      local.set $17
      local.get $16
      f64.const -0.499999997251031
      f64.mul
      f64.const 1
      f64.add
      local.get $17
      f64.const 0.04166662332373906
      f64.mul
      f64.add
      local.get $17
      local.get $16
      f64.mul
      local.get $16
      f64.const 2.439044879627741e-05
      f64.mul
      f64.const -0.001388676377460993
      f64.add
      f64.mul
      f64.add
      f32.demote_f64
     end
     return
    end
    local.get $0
    f64.promote_f32
    local.tee $18
    f64.const 3.141592653589793
    f64.add
    local.get $18
    f64.const -3.141592653589793
    f64.add
    local.get $6
    select
    f64.neg
    local.tee $2
    local.get $2
    f64.mul
    local.tee $1
    local.get $2
    f64.mul
    local.set $4
    br $folding-inner0
   end
   local.get $11
   i32.const 1088565717
   i32.le_u
   if
    local.get $11
    i32.const 1085271519
    i32.le_u
    if
     local.get $6
     if (result f32)
      local.get $0
      f64.promote_f32
      f64.const 4.71238898038469
      f64.add
      local.tee $19
      local.get $19
      f64.mul
      local.tee $20
      local.get $20
      f64.mul
      local.set $21
      local.get $20
      f64.const -0.499999997251031
      f64.mul
      f64.const 1
      f64.add
      local.get $21
      f64.const 0.04166662332373906
      f64.mul
      f64.add
      local.get $21
      local.get $20
      f64.mul
      local.get $20
      f64.const 2.439044879627741e-05
      f64.mul
      f64.const -0.001388676377460993
      f64.add
      f64.mul
      f64.add
      f32.demote_f64
     else
      local.get $0
      f64.promote_f32
      f64.const -4.71238898038469
      f64.add
      local.tee $22
      local.get $22
      f64.mul
      local.tee $23
      local.get $23
      f64.mul
      local.set $24
      local.get $23
      f64.const -0.499999997251031
      f64.mul
      f64.const 1
      f64.add
      local.get $24
      f64.const 0.04166662332373906
      f64.mul
      f64.add
      local.get $24
      local.get $23
      f64.mul
      local.get $23
      f64.const 2.439044879627741e-05
      f64.mul
      f64.const -0.001388676377460993
      f64.add
      f64.mul
      f64.add
      f32.demote_f64
      f32.neg
     end
     return
    end
    local.get $0
    f64.promote_f32
    local.tee $25
    f64.const 6.283185307179586
    f64.add
    local.get $25
    f64.const -6.283185307179586
    f64.add
    local.get $6
    select
    local.tee $2
    local.get $2
    f64.mul
    local.tee $1
    local.get $2
    f64.mul
    local.set $4
    br $folding-inner0
   end
   local.get $11
   i32.const 2139095040
   i32.ge_u
   if
    local.get $0
    local.get $0
    f32.sub
    return
   end
   block $~lib/math/rempio2f|inlined.0 (result i32)
    local.get $11
    i32.const 1305022427
    i32.lt_u
    if
     local.get $0
     f64.promote_f32
     local.tee $26
     f64.const 0.6366197723675814
     f64.mul
     f64.nearest
     local.set $27
     local.get $26
     local.get $27
     f64.const 1.5707963109016418
     f64.mul
     f64.sub
     local.get $27
     f64.const 1.5893254773528196e-08
     f64.mul
     f64.sub
     global.set $~lib/math/rempio2f_y
     local.get $27
     i32.trunc_sat_f64_s
     br $~lib/math/rempio2f|inlined.0
    end
    local.get $11
    i32.const 23
    i32.shr_u
    i32.const 152
    i32.sub
    local.tee $28
    i32.const 63
    i32.and
    i64.extend_i32_s
    local.set $29
    f64.const 8.515303950216386e-20
    local.get $0
    f64.promote_f32
    f64.copysign
    local.get $11
    i32.const 8388607
    i32.and
    i32.const 8388608
    i32.or
    i64.extend_i32_s
    local.tee $9
    local.get $28
    i32.const 6
    i32.shr_s
    i32.const 3
    i32.shl
    i32.const 1024
    i32.add
    local.tee $30
    i64.load
    local.get $29
    i64.shl
    local.get $30
    i64.load offset=8
    local.tee $31
    i64.const 64
    local.get $29
    i64.sub
    i64.shr_u
    i64.or
    i64.mul
    local.get $29
    i64.const 32
    i64.gt_u
    if (result i64)
     local.get $31
     local.get $29
     i64.const 32
     i64.sub
     i64.shl
     local.get $30
     i64.load offset=16
     i64.const 96
     local.get $29
     i64.sub
     i64.shr_u
     i64.or
    else
     local.get $31
     i64.const 32
     local.get $29
     i64.sub
     i64.shr_u
    end
    local.get $9
    i64.mul
    i64.const 32
    i64.shr_u
    i64.add
    local.tee $32
    i64.const 2
    i64.shl
    local.tee $33
    f64.convert_i64_s
    f64.mul
    global.set $~lib/math/rempio2f_y
    i32.const 0
    local.get $32
    i64.const 62
    i64.shr_u
    local.get $33
    i64.const 63
    i64.shr_u
    i64.add
    i32.wrap_i64
    local.tee $34
    i32.sub
    local.get $34
    local.get $6
    select
   end
   local.set $35
   global.get $~lib/math/rempio2f_y
   local.set $36
   local.get $35
   i32.const 1
   i32.and
   if (result f32)
    local.get $36
    local.get $36
    f64.mul
    local.tee $37
    local.get $37
    f64.mul
    local.set $38
    local.get $37
    f64.const -0.499999997251031
    f64.mul
    f64.const 1
    f64.add
    local.get $38
    f64.const 0.04166662332373906
    f64.mul
    f64.add
    local.get $38
    local.get $37
    f64.mul
    local.get $37
    f64.const 2.439044879627741e-05
    f64.mul
    f64.const -0.001388676377460993
    f64.add
    f64.mul
    f64.add
    f32.demote_f64
   else
    local.get $36
    local.get $36
    local.get $36
    f64.mul
    local.tee $39
    local.get $36
    f64.mul
    local.tee $40
    local.get $39
    f64.const 0.008333329385889463
    f64.mul
    f64.const -0.16666666641626524
    f64.add
    f64.mul
    f64.add
    local.get $40
    local.get $39
    local.get $39
    f64.mul
    f64.mul
    local.get $39
    f64.const 2.718311493989822e-06
    f64.mul
    f64.const -1.9839334836096632e-04
    f64.add
    f64.mul
    f64.add
    f32.demote_f64
   end
   local.tee $41
   f32.neg
   local.get $41
   local.get $35
   i32.const 2
   i32.and
   select
   return
  end
  local.get $2
  local.get $4
  local.get $1
  f64.const 0.008333329385889463
  f64.mul
  f64.const -0.16666666641626524
  f64.add
  f64.mul
  f64.add
  local.get $4
  local.get $1
  local.get $1
  f64.mul
  f64.mul
  local.get $1
  f64.const 2.718311493989822e-06
  f64.mul
  f64.const -1.9839334836096632e-04
  f64.add
  f64.mul
  f64.add
  f32.demote_f64
 )
 (func $~lib/math/NativeMathf.cos (param $0 f32) (result f32)
  (local $1 f64)
  (local $2 f64)
  (local $3 i32)
  (local $4 f64)
  (local $5 i64)
  (local $6 i32)
  (local $7 i32)
  (local $8 i64)
  (local $9 i64)
  (local $10 i32)
  (local $11 i32)
  (local $12 f64)
  (local $13 f64)
  (local $14 f64)
  (local $15 f64)
  (local $16 f64)
  (local $17 f64)
  (local $18 f64)
  (local $19 f64)
  (local $20 f64)
  (local $21 f64)
  (local $22 f64)
  (local $23 f64)
  (local $24 f64)
  (local $25 i32)
  (local $26 i64)
  (local $27 i32)
  (local $28 i64)
  (local $29 i64)
  (local $30 i64)
  (local $31 i32)
  (local $32 i32)
  (local $33 f64)
  (local $34 f64)
  (local $35 f64)
  (local $36 f64)
  (local $37 f64)
  (local $38 f32)
  local.get $0
  i32.reinterpret_f32
  local.tee $10
  i32.const 31
  i32.shr_u
  local.set $6
  local.get $10
  i32.const 2147483647
  i32.and
  local.tee $11
  i32.const 1061752794
  i32.le_u
  if
   local.get $11
   i32.const 964689920
   i32.lt_u
   if
    f32.const 1
    return
   end
   local.get $0
   f64.promote_f32
   local.tee $12
   local.get $12
   f64.mul
   local.tee $13
   local.get $13
   f64.mul
   local.set $14
   local.get $13
   f64.const -0.499999997251031
   f64.mul
   f64.const 1
   f64.add
   local.get $14
   f64.const 0.04166662332373906
   f64.mul
   f64.add
   local.get $14
   local.get $13
   f64.mul
   local.get $13
   f64.const 2.439044879627741e-05
   f64.mul
   f64.const -0.001388676377460993
   f64.add
   f64.mul
   f64.add
   f32.demote_f64
   return
  end
  local.get $11
  i32.const 1081824209
  i32.le_u
  if
   local.get $11
   i32.const 1075235811
   i32.gt_u
   if (result f32)
    local.get $0
    f64.promote_f32
    local.tee $15
    f64.const 3.141592653589793
    f64.add
    local.get $15
    f64.const -3.141592653589793
    f64.add
    local.get $6
    select
    local.tee $16
    local.get $16
    f64.mul
    local.tee $17
    local.get $17
    f64.mul
    local.set $18
    local.get $17
    f64.const -0.499999997251031
    f64.mul
    f64.const 1
    f64.add
    local.get $18
    f64.const 0.04166662332373906
    f64.mul
    f64.add
    local.get $18
    local.get $17
    f64.mul
    local.get $17
    f64.const 2.439044879627741e-05
    f64.mul
    f64.const -0.001388676377460993
    f64.add
    f64.mul
    f64.add
    f32.demote_f64
    f32.neg
   else
    local.get $6
    if (result f64)
     local.get $0
     f64.promote_f32
     f64.const 1.5707963267948966
     f64.add
     local.tee $2
     local.get $2
     f64.mul
     local.tee $1
     local.get $2
     f64.mul
    else
     f64.const 1.5707963267948966
     local.get $0
     f64.promote_f32
     f64.sub
     local.tee $2
     local.get $2
     f64.mul
     local.tee $1
     local.get $2
     f64.mul
    end
    local.set $4
    local.get $2
    local.get $4
    local.get $1
    f64.const 0.008333329385889463
    f64.mul
    f64.const -0.16666666641626524
    f64.add
    f64.mul
    f64.add
    local.get $4
    local.get $1
    local.get $1
    f64.mul
    f64.mul
    local.get $1
    f64.const 2.718311493989822e-06
    f64.mul
    f64.const -1.9839334836096632e-04
    f64.add
    f64.mul
    f64.add
    f32.demote_f64
   end
   return
  end
  local.get $11
  i32.const 1088565717
  i32.le_u
  if
   local.get $11
   i32.const 1085271519
   i32.gt_u
   if (result f32)
    local.get $0
    f64.promote_f32
    local.tee $19
    f64.const 6.283185307179586
    f64.add
    local.get $19
    f64.const -6.283185307179586
    f64.add
    local.get $6
    select
    local.tee $20
    local.get $20
    f64.mul
    local.tee $21
    local.get $21
    f64.mul
    local.set $22
    local.get $21
    f64.const -0.499999997251031
    f64.mul
    f64.const 1
    f64.add
    local.get $22
    f64.const 0.04166662332373906
    f64.mul
    f64.add
    local.get $22
    local.get $21
    f64.mul
    local.get $21
    f64.const 2.439044879627741e-05
    f64.mul
    f64.const -0.001388676377460993
    f64.add
    f64.mul
    f64.add
    f32.demote_f64
   else
    local.get $6
    if (result f64)
     local.get $0
     f32.neg
     f64.promote_f32
     f64.const -4.71238898038469
     f64.add
     local.tee $2
     local.get $2
     f64.mul
     local.tee $1
     local.get $2
     f64.mul
    else
     local.get $0
     f64.promote_f32
     f64.const -4.71238898038469
     f64.add
     local.tee $2
     local.get $2
     f64.mul
     local.tee $1
     local.get $2
     f64.mul
    end
    local.set $4
    local.get $2
    local.get $4
    local.get $1
    f64.const 0.008333329385889463
    f64.mul
    f64.const -0.16666666641626524
    f64.add
    f64.mul
    f64.add
    local.get $4
    local.get $1
    local.get $1
    f64.mul
    f64.mul
    local.get $1
    f64.const 2.718311493989822e-06
    f64.mul
    f64.const -1.9839334836096632e-04
    f64.add
    f64.mul
    f64.add
    f32.demote_f64
   end
   return
  end
  local.get $11
  i32.const 2139095040
  i32.ge_u
  if
   local.get $0
   local.get $0
   f32.sub
   return
  end
  block $~lib/math/rempio2f|inlined.1 (result i32)
   local.get $11
   i32.const 1305022427
   i32.lt_u
   if
    local.get $0
    f64.promote_f32
    local.tee $23
    f64.const 0.6366197723675814
    f64.mul
    f64.nearest
    local.set $24
    local.get $23
    local.get $24
    f64.const 1.5707963109016418
    f64.mul
    f64.sub
    local.get $24
    f64.const 1.5893254773528196e-08
    f64.mul
    f64.sub
    global.set $~lib/math/rempio2f_y
    local.get $24
    i32.trunc_sat_f64_s
    br $~lib/math/rempio2f|inlined.1
   end
   local.get $11
   i32.const 23
   i32.shr_u
   i32.const 152
   i32.sub
   local.tee $25
   i32.const 63
   i32.and
   i64.extend_i32_s
   local.set $26
   f64.const 8.515303950216386e-20
   local.get $0
   f64.promote_f32
   f64.copysign
   local.get $11
   i32.const 8388607
   i32.and
   i32.const 8388608
   i32.or
   i64.extend_i32_s
   local.tee $9
   local.get $25
   i32.const 6
   i32.shr_s
   i32.const 3
   i32.shl
   i32.const 1024
   i32.add
   local.tee $27
   i64.load
   local.get $26
   i64.shl
   local.get $27
   i64.load offset=8
   local.tee $28
   i64.const 64
   local.get $26
   i64.sub
   i64.shr_u
   i64.or
   i64.mul
   local.get $26
   i64.const 32
   i64.gt_u
   if (result i64)
    local.get $28
    local.get $26
    i64.const 32
    i64.sub
    i64.shl
    local.get $27
    i64.load offset=16
    i64.const 96
    local.get $26
    i64.sub
    i64.shr_u
    i64.or
   else
    local.get $28
    i64.const 32
    local.get $26
    i64.sub
    i64.shr_u
   end
   local.get $9
   i64.mul
   i64.const 32
   i64.shr_u
   i64.add
   local.tee $29
   i64.const 2
   i64.shl
   local.tee $30
   f64.convert_i64_s
   f64.mul
   global.set $~lib/math/rempio2f_y
   i32.const 0
   local.get $29
   i64.const 62
   i64.shr_u
   local.get $30
   i64.const 63
   i64.shr_u
   i64.add
   i32.wrap_i64
   local.tee $31
   i32.sub
   local.get $31
   local.get $6
   select
  end
  local.set $32
  global.get $~lib/math/rempio2f_y
  local.set $33
  local.get $32
  i32.const 1
  i32.and
  if (result f32)
   local.get $33
   local.get $33
   local.get $33
   f64.mul
   local.tee $34
   local.get $33
   f64.mul
   local.tee $35
   local.get $34
   f64.const 0.008333329385889463
   f64.mul
   f64.const -0.16666666641626524
   f64.add
   f64.mul
   f64.add
   local.get $35
   local.get $34
   local.get $34
   f64.mul
   f64.mul
   local.get $34
   f64.const 2.718311493989822e-06
   f64.mul
   f64.const -1.9839334836096632e-04
   f64.add
   f64.mul
   f64.add
   f32.demote_f64
  else
   local.get $33
   local.get $33
   f64.mul
   local.tee $36
   local.get $36
   f64.mul
   local.set $37
   local.get $36
   f64.const -0.499999997251031
   f64.mul
   f64.const 1
   f64.add
   local.get $37
   f64.const 0.04166662332373906
   f64.mul
   f64.add
   local.get $37
   local.get $36
   f64.mul
   local.get $36
   f64.const 2.439044879627741e-05
   f64.mul
   f64.const -0.001388676377460993
   f64.add
   f64.mul
   f64.add
   f32.demote_f64
  end
  local.tee $38
  f32.neg
  local.get $38
  local.get $32
  i32.const 1
  i32.add
  i32.const 2
  i32.and
  select
 )
 (func $assembly/index/getTerrainHeight (param $0 f32) (param $1 f32) (result f32)
  local.get $0
  f32.const 0.05000000074505806
  f32.mul
  call $~lib/math/NativeMathf.sin
  f32.const 2
  f32.mul
  local.get $1
  f32.const 0.05000000074505806
  f32.mul
  call $~lib/math/NativeMathf.cos
  f32.const 2
  f32.mul
  f32.add
  f32.const 0
  f32.add
  local.get $0
  f32.const 0.10000000149011612
  f32.mul
  call $~lib/math/NativeMathf.sin
  f32.const 0.800000011920929
  f32.mul
  local.get $1
  f32.const 0.10000000149011612
  f32.mul
  call $~lib/math/NativeMathf.cos
  f32.const 0.800000011920929
  f32.mul
  f32.add
  f32.add
  local.get $0
  f32.const 0.20000000298023224
  f32.mul
  call $~lib/math/NativeMathf.sin
  f32.const 0.30000001192092896
  f32.mul
  local.get $1
  f32.const 0.20000000298023224
  f32.mul
  call $~lib/math/NativeMathf.cos
  f32.const 0.30000001192092896
  f32.mul
  f32.add
  f32.add
 )
 (func $assembly/index/generateTerrainMesh (param $0 i32) (param $1 i32) (param $2 i32) (param $3 f32)
  (local $4 i32)
  (local $5 i32)
  (local $6 f32)
  (local $7 f32)
  local.get $1
  f32.convert_i32_s
  f32.const -1
  f32.add
  local.get $3
  f32.mul
  f32.const 0.5
  f32.mul
  local.set $6
  local.get $2
  f32.convert_i32_s
  f32.const -1
  f32.add
  local.get $3
  f32.mul
  f32.const 0.5
  f32.mul
  local.set $7
  loop $for-loop|0
   local.get $2
   local.get $4
   i32.gt_s
   if
    i32.const 0
    local.set $5
    loop $for-loop|1
     local.get $1
     local.get $5
     i32.gt_s
     if
      local.get $5
      local.get $1
      local.get $4
      i32.mul
      i32.add
      i32.const 2
      i32.shl
      local.get $0
      i32.add
      local.get $5
      f32.convert_i32_s
      local.get $3
      f32.mul
      local.get $6
      f32.sub
      local.get $4
      f32.convert_i32_s
      local.get $3
      f32.mul
      local.get $7
      f32.sub
      f32.neg
      call $assembly/index/getTerrainHeight
      f32.store
      local.get $5
      i32.const 1
      i32.add
      local.set $5
      br $for-loop|1
     end
    end
    local.get $4
    i32.const 1
    i32.add
    local.set $4
    br $for-loop|0
   end
  end
 )
)
