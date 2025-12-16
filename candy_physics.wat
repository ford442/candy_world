(module
 (type $0 (func (param i32)))
 (type $1 (func))
 (type $2 (func (param f32 f32 f32) (result f32)))
 (type $3 (func (param f32) (result f32)))
 (type $4 (func (result f32)))
 (type $5 (func (param i32 i32)))
 (type $6 (func (param i32 i32) (result i32)))
 (type $7 (func (param f32 f32) (result f32)))
 (type $8 (func (param f32 f32 f32 i32) (result i32)))
 (type $9 (func (param f32 f32 f32 f32 i32) (result i32)))
 (type $10 (func (param f32 f32 f32 i32)))
 (type $11 (func (param f32 f32 f32 f32) (result f32)))
 (type $12 (func (param f32 f32 f32)))
 (type $13 (func (param i32 i32 i32 i32)))
 (type $14 (func (param i32 i32 i64)))
 (type $15 (func (result i32)))
 (type $16 (func (param i32) (result i32)))
 (import "env" "abort" (func $~lib/builtins/abort (param i32 i32 i32 i32)))
 (global $assembly/index/wobbleResultX (mut f32) (f32.const 0))
 (global $assembly/index/wobbleResultZ (mut f32) (f32.const 0))
 (global $~lib/math/rempio2f_y (mut f64) (f64.const 0))
 (global $~lib/rt/itcms/total (mut i32) (i32.const 0))
 (global $~lib/rt/itcms/threshold (mut i32) (i32.const 0))
 (global $~lib/rt/itcms/state (mut i32) (i32.const 0))
 (global $~lib/rt/itcms/visitCount (mut i32) (i32.const 0))
 (global $~lib/rt/itcms/pinSpace (mut i32) (i32.const 0))
 (global $~lib/rt/itcms/iter (mut i32) (i32.const 0))
 (global $~lib/rt/itcms/toSpace (mut i32) (i32.const 0))
 (global $~lib/rt/itcms/white (mut i32) (i32.const 0))
 (global $~lib/rt/itcms/fromSpace (mut i32) (i32.const 0))
 (global $~lib/rt/tlsf/ROOT (mut i32) (i32.const 0))
 (global $~lib/rt/__rtti_base i32 (i32.const 1856))
 (memory $0 1)
 (data $0 (i32.const 1024) ")\15DNn\83\f9\a2\c0\dd4\f5\d1W\'\fcA\90C<\99\95b\dba\c5\bb\de\abcQ\fe")
 (data $1 (i32.const 1056) "\be\f3\f8y\eca\f6?\190\96[\c6\fe\de\bf=\88\afJ\edq\f5?\a4\fc\d42h\0b\db\bf\b0\10\f0\f09\95\f4?{\b7\1f\n\8bA\d7\bf\85\03\b8\b0\95\c9\f3?{\cfm\1a\e9\9d\d3\bf\a5d\88\0c\19\r\f3?1\b6\f2\f3\9b\1d\d0\bf\a0\8e\0b{\"^\f2?\f0z;\1b\1d|\c9\bf?4\1aJJ\bb\f1?\9f<\af\93\e3\f9\c2\bf\ba\e5\8a\f0X#\f1?\\\8dx\bf\cb`\b9\bf\a7\00\99A?\95\f0?\ce_G\b6\9do\aa\bf\00\00\00\00\00\00\f0?\00\00\00\00\00\00\00\00\acG\9a\fd\8c`\ee?=\f5$\9f\ca8\b3?\a0j\02\1f\b3\a4\ec?\ba\918T\a9v\c4?\e6\fcjW6 \eb?\d2\e4\c4J\0b\84\ce?-\aa\a1c\d1\c2\e9?\1ce\c6\f0E\06\d4?\edAx\03\e6\86\e8?\f8\9f\1b,\9c\8e\d8?bHS\f5\dcg\e7?\cc{\b1N\a4\e0\dc?")
 (data $2 (i32.const 1324) "<")
 (data $2.1 (i32.const 1336) "\02\00\00\00(\00\00\00A\00l\00l\00o\00c\00a\00t\00i\00o\00n\00 \00t\00o\00o\00 \00l\00a\00r\00g\00e")
 (data $3 (i32.const 1388) "<")
 (data $3.1 (i32.const 1400) "\02\00\00\00 \00\00\00~\00l\00i\00b\00/\00r\00t\00/\00i\00t\00c\00m\00s\00.\00t\00s")
 (data $6 (i32.const 1516) "<")
 (data $6.1 (i32.const 1528) "\02\00\00\00$\00\00\00I\00n\00d\00e\00x\00 \00o\00u\00t\00 \00o\00f\00 \00r\00a\00n\00g\00e")
 (data $7 (i32.const 1580) ",")
 (data $7.1 (i32.const 1592) "\02\00\00\00\14\00\00\00~\00l\00i\00b\00/\00r\00t\00.\00t\00s")
 (data $9 (i32.const 1660) "<")
 (data $9.1 (i32.const 1672) "\02\00\00\00\1e\00\00\00~\00l\00i\00b\00/\00r\00t\00/\00t\00l\00s\00f\00.\00t\00s")
 (data $10 (i32.const 1724) "<")
 (data $10.1 (i32.const 1736) "\02\00\00\00*\00\00\00O\00b\00j\00e\00c\00t\00 \00a\00l\00r\00e\00a\00d\00y\00 \00p\00i\00n\00n\00e\00d")
 (data $11 (i32.const 1788) "<")
 (data $11.1 (i32.const 1800) "\02\00\00\00(\00\00\00O\00b\00j\00e\00c\00t\00 \00i\00s\00 \00n\00o\00t\00 \00p\00i\00n\00n\00e\00d")
 (data $12 (i32.const 1856) "\04\00\00\00 \00\00\00 \00\00\00 ")
 (export "lerp" (func $assembly/index/lerp))
 (export "clamp" (func $assembly/index/clamp))
 (export "getGroundHeight" (func $assembly/index/getGroundHeight))
 (export "freqToHue" (func $assembly/index/freqToHue))
 (export "checkCollision" (func $assembly/index/checkCollision))
 (export "batchDistanceCull" (func $assembly/index/batchDistanceCull))
 (export "batchAnimationCalc" (func $assembly/index/batchAnimationCalc))
 (export "calcBounceY" (func $assembly/index/calcBounceY))
 (export "calcSwayRotZ" (func $assembly/index/calcSwayRotZ))
 (export "calcWobble" (func $assembly/index/calcWobble))
 (export "getWobbleX" (func $assembly/index/getWobbleX))
 (export "getWobbleZ" (func $assembly/index/getWobbleZ))
 (export "__new" (func $~lib/rt/itcms/__new))
 (export "__pin" (func $~lib/rt/itcms/__pin))
 (export "__unpin" (func $~lib/rt/itcms/__unpin))
 (export "__collect" (func $~lib/rt/itcms/__collect))
 (export "__rtti_base" (global $~lib/rt/__rtti_base))
 (export "memory" (memory $0))
 (start $~start)
 (func $assembly/index/lerp (param $0 f32) (param $1 f32) (param $2 f32) (result f32)
  local.get $0
  local.get $1
  local.get $0
  f32.sub
  local.get $2
  f32.mul
  f32.add
 )
 (func $assembly/index/clamp (param $0 f32) (param $1 f32) (param $2 f32) (result f32)
  local.get $1
  local.get $0
  local.get $2
  f32.min
  f32.max
 )
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
  local.get $0
  i32.reinterpret_f32
  local.tee $3
  i32.const 31
  i32.shr_u
  local.set $6
  block $folding-inner0
   local.get $3
   i32.const 2147483647
   i32.and
   local.tee $3
   i32.const 1061752794
   i32.le_u
   if
    local.get $3
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
   local.get $3
   i32.const 1081824209
   i32.le_u
   if
    local.get $3
    i32.const 1075235811
    i32.le_u
    if
     local.get $6
     if (result f32)
      local.get $0
      f64.promote_f32
      f64.const 1.5707963267948966
      f64.add
      local.tee $1
      local.get $1
      f64.mul
      local.tee $1
      local.get $1
      f64.mul
      local.set $2
      local.get $1
      f64.const -0.499999997251031
      f64.mul
      f64.const 1
      f64.add
      local.get $2
      f64.const 0.04166662332373906
      f64.mul
      f64.add
      local.get $2
      local.get $1
      f64.mul
      local.get $1
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
      local.tee $1
      local.get $1
      f64.mul
      local.tee $1
      local.get $1
      f64.mul
      local.set $2
      local.get $1
      f64.const -0.499999997251031
      f64.mul
      f64.const 1
      f64.add
      local.get $2
      f64.const 0.04166662332373906
      f64.mul
      f64.add
      local.get $2
      local.get $1
      f64.mul
      local.get $1
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
    local.tee $1
    f64.const 3.141592653589793
    f64.add
    local.get $1
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
   local.get $3
   i32.const 1088565717
   i32.le_u
   if
    local.get $3
    i32.const 1085271519
    i32.le_u
    if
     local.get $6
     if (result f32)
      local.get $0
      f64.promote_f32
      f64.const 4.71238898038469
      f64.add
      local.tee $1
      local.get $1
      f64.mul
      local.tee $1
      local.get $1
      f64.mul
      local.set $2
      local.get $1
      f64.const -0.499999997251031
      f64.mul
      f64.const 1
      f64.add
      local.get $2
      f64.const 0.04166662332373906
      f64.mul
      f64.add
      local.get $2
      local.get $1
      f64.mul
      local.get $1
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
      local.tee $1
      local.get $1
      f64.mul
      local.tee $1
      local.get $1
      f64.mul
      local.set $2
      local.get $1
      f64.const -0.499999997251031
      f64.mul
      f64.const 1
      f64.add
      local.get $2
      f64.const 0.04166662332373906
      f64.mul
      f64.add
      local.get $2
      local.get $1
      f64.mul
      local.get $1
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
    local.tee $1
    f64.const 6.283185307179586
    f64.add
    local.get $1
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
   local.get $3
   i32.const 2139095040
   i32.ge_u
   if
    local.get $0
    local.get $0
    f32.sub
    return
   end
   block $~lib/math/rempio2f|inlined.0 (result i32)
    local.get $3
    i32.const 1305022427
    i32.lt_u
    if
     local.get $0
     f64.promote_f32
     local.tee $1
     f64.const 0.6366197723675814
     f64.mul
     f64.nearest
     local.set $2
     local.get $1
     local.get $2
     f64.const 1.5707963109016418
     f64.mul
     f64.sub
     local.get $2
     f64.const 1.5893254773528196e-08
     f64.mul
     f64.sub
     global.set $~lib/math/rempio2f_y
     local.get $2
     i32.trunc_sat_f64_s
     br $~lib/math/rempio2f|inlined.0
    end
    local.get $3
    i32.const 23
    i32.shr_s
    i32.const 152
    i32.sub
    local.tee $7
    i32.const 63
    i32.and
    i64.extend_i32_s
    local.set $8
    local.get $7
    i32.const 6
    i32.shr_s
    i32.const 3
    i32.shl
    i32.const 1024
    i32.add
    local.tee $7
    i64.load offset=8
    local.set $5
    f64.const 8.515303950216386e-20
    local.get $0
    f64.promote_f32
    f64.copysign
    local.get $3
    i32.const 8388607
    i32.and
    i32.const 8388608
    i32.or
    i64.extend_i32_s
    local.tee $9
    local.get $7
    i64.load
    local.get $8
    i64.shl
    local.get $5
    i64.const 64
    local.get $8
    i64.sub
    i64.shr_u
    i64.or
    i64.mul
    local.get $8
    i64.const 32
    i64.gt_u
    if (result i64)
     local.get $5
     local.get $8
     i64.const 32
     i64.sub
     i64.shl
     local.get $7
     i64.load offset=16
     i64.const 96
     local.get $8
     i64.sub
     i64.shr_u
     i64.or
    else
     local.get $5
     i64.const 32
     local.get $8
     i64.sub
     i64.shr_u
    end
    local.get $9
    i64.mul
    i64.const 32
    i64.shr_u
    i64.add
    local.tee $5
    i64.const 2
    i64.shl
    local.tee $8
    f64.convert_i64_s
    f64.mul
    global.set $~lib/math/rempio2f_y
    i32.const 0
    local.get $5
    i64.const 62
    i64.shr_u
    local.get $8
    i64.const 63
    i64.shr_u
    i64.add
    i32.wrap_i64
    local.tee $3
    i32.sub
    local.get $3
    local.get $6
    select
   end
   local.set $3
   global.get $~lib/math/rempio2f_y
   local.set $1
   local.get $3
   i32.const 1
   i32.and
   if (result f32)
    local.get $1
    local.get $1
    f64.mul
    local.tee $1
    local.get $1
    f64.mul
    local.set $2
    local.get $1
    f64.const -0.499999997251031
    f64.mul
    f64.const 1
    f64.add
    local.get $2
    f64.const 0.04166662332373906
    f64.mul
    f64.add
    local.get $2
    local.get $1
    f64.mul
    local.get $1
    f64.const 2.439044879627741e-05
    f64.mul
    f64.const -0.001388676377460993
    f64.add
    f64.mul
    f64.add
    f32.demote_f64
   else
    local.get $1
    local.get $1
    local.get $1
    f64.mul
    local.tee $2
    local.get $1
    f64.mul
    local.tee $1
    local.get $2
    f64.const 0.008333329385889463
    f64.mul
    f64.const -0.16666666641626524
    f64.add
    f64.mul
    f64.add
    local.get $1
    local.get $2
    local.get $2
    f64.mul
    f64.mul
    local.get $2
    f64.const 2.718311493989822e-06
    f64.mul
    f64.const -1.9839334836096632e-04
    f64.add
    f64.mul
    f64.add
    f32.demote_f64
   end
   local.tee $0
   f32.neg
   local.get $0
   local.get $3
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
  (local $4 i64)
  (local $5 i32)
  (local $6 f64)
  (local $7 i32)
  (local $8 i64)
  (local $9 i64)
  local.get $0
  i32.reinterpret_f32
  local.tee $3
  i32.const 31
  i32.shr_u
  local.set $5
  block $folding-inner0
   local.get $3
   i32.const 2147483647
   i32.and
   local.tee $3
   i32.const 1061752794
   i32.le_u
   if
    local.get $3
    i32.const 964689920
    i32.lt_u
    if
     f32.const 1
     return
    end
    local.get $0
    f64.promote_f32
    local.tee $1
    local.get $1
    f64.mul
    local.tee $1
    local.get $1
    f64.mul
    local.set $2
    br $folding-inner0
   end
   local.get $3
   i32.const 1081824209
   i32.le_u
   if
    local.get $3
    i32.const 1075235811
    i32.gt_u
    if
     local.get $0
     f64.promote_f32
     local.tee $1
     f64.const 3.141592653589793
     f64.add
     local.get $1
     f64.const -3.141592653589793
     f64.add
     local.get $5
     select
     local.tee $1
     local.get $1
     f64.mul
     local.tee $1
     local.get $1
     f64.mul
     local.set $2
     local.get $1
     f64.const -0.499999997251031
     f64.mul
     f64.const 1
     f64.add
     local.get $2
     f64.const 0.04166662332373906
     f64.mul
     f64.add
     local.get $2
     local.get $1
     f64.mul
     local.get $1
     f64.const 2.439044879627741e-05
     f64.mul
     f64.const -0.001388676377460993
     f64.add
     f64.mul
     f64.add
     f32.demote_f64
     f32.neg
     return
    else
     local.get $5
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
     local.set $6
     local.get $2
     local.get $6
     local.get $1
     f64.const 0.008333329385889463
     f64.mul
     f64.const -0.16666666641626524
     f64.add
     f64.mul
     f64.add
     local.get $6
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
     return
    end
    unreachable
   end
   local.get $3
   i32.const 1088565717
   i32.le_u
   if
    local.get $3
    i32.const 1085271519
    i32.gt_u
    if
     local.get $0
     f64.promote_f32
     local.tee $1
     f64.const 6.283185307179586
     f64.add
     local.get $1
     f64.const -6.283185307179586
     f64.add
     local.get $5
     select
     local.tee $1
     local.get $1
     f64.mul
     local.tee $1
     local.get $1
     f64.mul
     local.set $2
     br $folding-inner0
    else
     local.get $5
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
     local.set $6
     local.get $2
     local.get $6
     local.get $1
     f64.const 0.008333329385889463
     f64.mul
     f64.const -0.16666666641626524
     f64.add
     f64.mul
     f64.add
     local.get $6
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
     return
    end
    unreachable
   end
   local.get $3
   i32.const 2139095040
   i32.ge_u
   if
    local.get $0
    local.get $0
    f32.sub
    return
   end
   block $~lib/math/rempio2f|inlined.1 (result i32)
    local.get $3
    i32.const 1305022427
    i32.lt_u
    if
     local.get $0
     f64.promote_f32
     local.tee $1
     f64.const 0.6366197723675814
     f64.mul
     f64.nearest
     local.set $2
     local.get $1
     local.get $2
     f64.const 1.5707963109016418
     f64.mul
     f64.sub
     local.get $2
     f64.const 1.5893254773528196e-08
     f64.mul
     f64.sub
     global.set $~lib/math/rempio2f_y
     local.get $2
     i32.trunc_sat_f64_s
     br $~lib/math/rempio2f|inlined.1
    end
    local.get $3
    i32.const 23
    i32.shr_s
    i32.const 152
    i32.sub
    local.tee $7
    i32.const 63
    i32.and
    i64.extend_i32_s
    local.set $8
    local.get $7
    i32.const 6
    i32.shr_s
    i32.const 3
    i32.shl
    i32.const 1024
    i32.add
    local.tee $7
    i64.load offset=8
    local.set $4
    f64.const 8.515303950216386e-20
    local.get $0
    f64.promote_f32
    f64.copysign
    local.get $3
    i32.const 8388607
    i32.and
    i32.const 8388608
    i32.or
    i64.extend_i32_s
    local.tee $9
    local.get $7
    i64.load
    local.get $8
    i64.shl
    local.get $4
    i64.const 64
    local.get $8
    i64.sub
    i64.shr_u
    i64.or
    i64.mul
    local.get $8
    i64.const 32
    i64.gt_u
    if (result i64)
     local.get $4
     local.get $8
     i64.const 32
     i64.sub
     i64.shl
     local.get $7
     i64.load offset=16
     i64.const 96
     local.get $8
     i64.sub
     i64.shr_u
     i64.or
    else
     local.get $4
     i64.const 32
     local.get $8
     i64.sub
     i64.shr_u
    end
    local.get $9
    i64.mul
    i64.const 32
    i64.shr_u
    i64.add
    local.tee $4
    i64.const 2
    i64.shl
    local.tee $8
    f64.convert_i64_s
    f64.mul
    global.set $~lib/math/rempio2f_y
    i32.const 0
    local.get $4
    i64.const 62
    i64.shr_u
    local.get $8
    i64.const 63
    i64.shr_u
    i64.add
    i32.wrap_i64
    local.tee $3
    i32.sub
    local.get $3
    local.get $5
    select
   end
   local.set $3
   global.get $~lib/math/rempio2f_y
   local.set $1
   local.get $3
   i32.const 1
   i32.and
   if (result f32)
    local.get $1
    local.get $1
    local.get $1
    f64.mul
    local.tee $2
    local.get $1
    f64.mul
    local.tee $1
    local.get $2
    f64.const 0.008333329385889463
    f64.mul
    f64.const -0.16666666641626524
    f64.add
    f64.mul
    f64.add
    local.get $1
    local.get $2
    local.get $2
    f64.mul
    f64.mul
    local.get $2
    f64.const 2.718311493989822e-06
    f64.mul
    f64.const -1.9839334836096632e-04
    f64.add
    f64.mul
    f64.add
    f32.demote_f64
   else
    local.get $1
    local.get $1
    f64.mul
    local.tee $1
    local.get $1
    f64.mul
    local.set $2
    local.get $1
    f64.const -0.499999997251031
    f64.mul
    f64.const 1
    f64.add
    local.get $2
    f64.const 0.04166662332373906
    f64.mul
    f64.add
    local.get $2
    local.get $1
    f64.mul
    local.get $1
    f64.const 2.439044879627741e-05
    f64.mul
    f64.const -0.001388676377460993
    f64.add
    f64.mul
    f64.add
    f32.demote_f64
   end
   local.tee $0
   f32.neg
   local.get $0
   local.get $3
   i32.const 1
   i32.add
   i32.const 2
   i32.and
   select
   return
  end
  local.get $1
  f64.const -0.499999997251031
  f64.mul
  f64.const 1
  f64.add
  local.get $2
  f64.const 0.04166662332373906
  f64.mul
  f64.add
  local.get $2
  local.get $1
  f64.mul
  local.get $1
  f64.const 2.439044879627741e-05
  f64.mul
  f64.const -0.001388676377460993
  f64.add
  f64.mul
  f64.add
  f32.demote_f64
 )
 (func $assembly/index/getGroundHeight (param $0 f32) (param $1 f32) (result f32)
  local.get $1
  local.get $1
  f32.ne
  local.get $0
  local.get $0
  f32.ne
  i32.or
  if
   f32.const 0
   return
  end
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
  local.get $0
  f32.const 0.20000000298023224
  f32.mul
  call $~lib/math/NativeMathf.sin
  f32.const 0.30000001192092896
  f32.mul
  local.get $1
  f32.const 0.15000000596046448
  f32.mul
  call $~lib/math/NativeMathf.cos
  f32.const 0.30000001192092896
  f32.mul
  f32.add
  f32.add
 )
 (func $assembly/index/freqToHue (param $0 f32) (result f32)
  (local $1 i32)
  (local $2 f64)
  (local $3 f64)
  (local $4 i32)
  (local $5 i32)
  local.get $0
  f32.const 50
  f32.lt
  if
   f32.const 0
   return
  end
  block $~lib/util/math/log2f_lut|inlined.0 (result f32)
   local.get $0
   f32.const 55
   f32.div
   local.tee $0
   i32.reinterpret_f32
   local.tee $1
   i32.const 8388608
   i32.sub
   i32.const 2130706432
   i32.ge_u
   if
    f32.const -inf
    local.get $1
    i32.const 1
    i32.shl
    local.tee $4
    i32.eqz
    br_if $~lib/util/math/log2f_lut|inlined.0
    drop
    local.get $0
    local.get $1
    i32.const 2139095040
    i32.eq
    br_if $~lib/util/math/log2f_lut|inlined.0
    drop
    local.get $1
    i32.const 31
    i32.shr_u
    local.get $4
    i32.const -16777216
    i32.ge_u
    i32.or
    if
     local.get $0
     local.get $0
     f32.sub
     local.tee $0
     local.get $0
     f32.div
     br $~lib/util/math/log2f_lut|inlined.0
    end
    local.get $0
    f32.const 8388608
    f32.mul
    i32.reinterpret_f32
    i32.const 192937984
    i32.sub
    local.set $1
   end
   local.get $1
   i32.const 1060306944
   i32.sub
   local.tee $4
   i32.const 19
   i32.shr_u
   i32.const 15
   i32.and
   i32.const 4
   i32.shl
   i32.const 1056
   i32.add
   local.set $5
   local.get $1
   local.get $4
   i32.const -8388608
   i32.and
   i32.sub
   f32.reinterpret_i32
   f64.promote_f32
   local.get $5
   f64.load
   f64.mul
   f64.const -1
   f64.add
   local.tee $2
   local.get $2
   f64.mul
   local.set $3
   local.get $2
   f64.const 0.4811247078767291
   f64.mul
   f64.const -0.7213476299867769
   f64.add
   local.get $3
   f64.const -0.36051725506874704
   f64.mul
   f64.add
   local.get $3
   f64.mul
   local.get $2
   f64.const 1.4426950186867042
   f64.mul
   local.get $5
   f64.load offset=8
   local.get $4
   i32.const 23
   i32.shr_s
   f64.convert_i32_s
   f64.add
   f64.add
   f64.add
   f32.demote_f64
  end
  f32.const 0.10000000149011612
  f32.mul
  local.tee $0
  local.get $0
  f32.trunc
  f32.sub
  local.get $0
  f32.copysign
 )
 (func $assembly/index/checkCollision (param $0 f32) (param $1 f32) (param $2 f32) (param $3 i32) (result i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 f32)
  loop $for-loop|0
   local.get $3
   local.get $4
   i32.gt_s
   if
    local.get $0
    local.get $4
    i32.const 4
    i32.shl
    local.tee $5
    f32.load
    f32.sub
    local.tee $6
    local.get $6
    f32.mul
    local.get $1
    local.get $5
    f32.load offset=8
    f32.sub
    local.tee $6
    local.get $6
    f32.mul
    f32.add
    local.get $2
    local.get $5
    f32.load offset=12
    f32.add
    local.tee $6
    local.get $6
    f32.mul
    f32.lt
    if
     i32.const 1
     return
    end
    local.get $4
    i32.const 1
    i32.add
    local.set $4
    br $for-loop|0
   end
  end
  i32.const 0
 )
 (func $assembly/index/batchDistanceCull (param $0 f32) (param $1 f32) (param $2 f32) (param $3 f32) (param $4 i32) (result i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 f32)
  loop $for-loop|0
   local.get $4
   local.get $5
   i32.gt_s
   if
    local.get $5
    i32.const 2
    i32.shl
    i32.const -8192
    i32.sub
    local.set $6
    local.get $0
    local.get $5
    i32.const 4
    i32.shl
    local.tee $7
    f32.load
    f32.sub
    local.tee $9
    local.get $9
    f32.mul
    local.get $1
    local.get $7
    f32.load offset=4
    f32.sub
    local.tee $9
    local.get $9
    f32.mul
    f32.add
    local.get $2
    local.get $7
    f32.load offset=8
    f32.sub
    local.tee $9
    local.get $9
    f32.mul
    f32.add
    local.get $3
    f32.le
    if
     local.get $6
     f32.const 1
     f32.store
     local.get $8
     i32.const 1
     i32.add
     local.set $8
    else
     local.get $6
     f32.const 0
     f32.store
    end
    local.get $5
    i32.const 1
    i32.add
    local.set $5
    br $for-loop|0
   end
  end
  local.get $8
 )
 (func $assembly/index/batchAnimationCalc (param $0 f32) (param $1 f32) (param $2 f32) (param $3 i32)
  (local $4 f32)
  (local $5 i32)
  (local $6 f32)
  (local $7 f32)
  (local $8 f32)
  (local $9 f32)
  (local $10 i32)
  (local $11 i32)
  loop $for-loop|0
   local.get $3
   local.get $5
   i32.gt_s
   if
    local.get $5
    i32.const 4
    i32.shl
    local.tee $10
    i32.const 4096
    i32.add
    local.tee $11
    f32.load
    local.set $7
    local.get $11
    f32.load offset=8
    drop
    local.get $0
    local.get $7
    f32.add
    local.set $9
    f32.const 0
    local.set $4
    f32.const 0
    local.set $8
    f32.const 0
    local.set $6
    local.get $11
    f32.load offset=4
    i32.trunc_sat_f32_s
    local.tee $11
    i32.const 1
    i32.eq
    if
     local.get $9
     f32.const 3
     f32.mul
     call $~lib/math/NativeMathf.sin
     f32.const 0.10000000149011612
     f32.mul
     local.get $1
     f32.mul
     local.tee $4
     local.get $2
     f32.const 0.20000000298023224
     f32.mul
     f32.add
     local.get $4
     local.get $2
     f32.const 0.10000000149011612
     f32.gt
     select
     local.set $4
    else
     local.get $11
     i32.const 2
     i32.eq
     if
      local.get $0
      local.get $7
      f32.add
      call $~lib/math/NativeMathf.sin
      f32.const 0.10000000149011612
      f32.mul
      local.get $1
      f32.mul
      local.set $6
     else
      local.get $11
      i32.const 3
      i32.eq
      if
       local.get $9
       f32.const 3
       f32.mul
       local.tee $6
       call $~lib/math/NativeMathf.sin
       f32.const 0.15000000596046448
       f32.mul
       local.get $1
       f32.mul
       local.set $8
       local.get $6
       call $~lib/math/NativeMathf.cos
       f32.const 0.15000000596046448
       f32.mul
       local.get $1
       f32.mul
       local.set $6
      else
       local.get $11
       i32.const 4
       i32.eq
       if (result f32)
        local.get $9
        f32.const 4
        f32.mul
        call $~lib/math/NativeMathf.sin
        f32.const 0
        f32.max
        f32.const 0.30000001192092896
        f32.mul
        local.get $1
        f32.mul
        local.tee $4
        local.get $2
        f32.const 0.15000000596046448
        f32.mul
        f32.add
        local.get $4
        local.get $2
        f32.const 0.10000000149011612
        f32.gt
        select
       else
        f32.const 0
       end
       local.set $4
      end
     end
    end
    local.get $10
    i32.const -8192
    i32.sub
    local.tee $10
    local.get $4
    f32.store
    local.get $10
    local.get $8
    f32.store offset=4
    local.get $10
    local.get $6
    f32.store offset=8
    local.get $10
    f32.const 0
    f32.store offset=12
    local.get $5
    i32.const 1
    i32.add
    local.set $5
    br $for-loop|0
   end
  end
 )
 (func $assembly/index/calcBounceY (param $0 f32) (param $1 f32) (param $2 f32) (param $3 f32) (result f32)
  local.get $0
  local.get $1
  f32.add
  f32.const 3
  f32.mul
  call $~lib/math/NativeMathf.sin
  f32.const 0.10000000149011612
  f32.mul
  local.get $2
  f32.mul
  local.tee $0
  local.get $3
  f32.const 0.20000000298023224
  f32.mul
  f32.add
  local.get $0
  local.get $3
  f32.const 0.10000000149011612
  f32.gt
  select
 )
 (func $assembly/index/calcSwayRotZ (param $0 f32) (param $1 f32) (param $2 f32) (result f32)
  local.get $0
  local.get $1
  f32.add
  call $~lib/math/NativeMathf.sin
  f32.const 0.10000000149011612
  f32.mul
  local.get $2
  f32.mul
 )
 (func $assembly/index/calcWobble (param $0 f32) (param $1 f32) (param $2 f32)
  local.get $0
  local.get $1
  f32.add
  f32.const 3
  f32.mul
  local.tee $0
  call $~lib/math/NativeMathf.sin
  f32.const 0.15000000596046448
  f32.mul
  local.get $2
  f32.mul
  global.set $assembly/index/wobbleResultX
  local.get $0
  call $~lib/math/NativeMathf.cos
  f32.const 0.15000000596046448
  f32.mul
  local.get $2
  f32.mul
  global.set $assembly/index/wobbleResultZ
 )
 (func $assembly/index/getWobbleX (result f32)
  global.get $assembly/index/wobbleResultX
 )
 (func $assembly/index/getWobbleZ (result f32)
  global.get $assembly/index/wobbleResultZ
 )
 (func $~lib/rt/itcms/visitRoots
  (local $0 i32)
  (local $1 i32)
  i32.const 1536
  call $~lib/rt/itcms/__visit
  i32.const 1344
  call $~lib/rt/itcms/__visit
  i32.const 1744
  call $~lib/rt/itcms/__visit
  i32.const 1808
  call $~lib/rt/itcms/__visit
  global.get $~lib/rt/itcms/pinSpace
  local.tee $1
  i32.load offset=4
  i32.const -4
  i32.and
  local.set $0
  loop $while-continue|0
   local.get $0
   local.get $1
   i32.ne
   if
    local.get $0
    i32.load offset=4
    i32.const 3
    i32.and
    i32.const 3
    i32.ne
    if
     i32.const 0
     i32.const 1408
     i32.const 160
     i32.const 16
     call $~lib/builtins/abort
     unreachable
    end
    local.get $0
    i32.const 20
    i32.add
    call $~lib/rt/__visit_members
    local.get $0
    i32.load offset=4
    i32.const -4
    i32.and
    local.set $0
    br $while-continue|0
   end
  end
 )
 (func $~lib/rt/itcms/Object#unlink (param $0 i32)
  (local $1 i32)
  local.get $0
  i32.load offset=4
  i32.const -4
  i32.and
  local.tee $1
  i32.eqz
  if
   local.get $0
   i32.load offset=8
   i32.eqz
   local.get $0
   i32.const 34644
   i32.lt_u
   i32.and
   i32.eqz
   if
    i32.const 0
    i32.const 1408
    i32.const 128
    i32.const 18
    call $~lib/builtins/abort
    unreachable
   end
   return
  end
  local.get $0
  i32.load offset=8
  local.tee $0
  i32.eqz
  if
   i32.const 0
   i32.const 1408
   i32.const 132
   i32.const 16
   call $~lib/builtins/abort
   unreachable
  end
  local.get $1
  local.get $0
  i32.store offset=8
  local.get $0
  local.get $1
  local.get $0
  i32.load offset=4
  i32.const 3
  i32.and
  i32.or
  i32.store offset=4
 )
 (func $~lib/rt/itcms/Object#makeGray (param $0 i32)
  (local $1 i32)
  (local $2 i32)
  (local $3 i32)
  local.get $0
  global.get $~lib/rt/itcms/iter
  i32.eq
  if
   local.get $0
   i32.load offset=8
   local.tee $1
   i32.eqz
   if
    i32.const 0
    i32.const 1408
    i32.const 148
    i32.const 30
    call $~lib/builtins/abort
    unreachable
   end
   local.get $1
   global.set $~lib/rt/itcms/iter
  end
  local.get $0
  call $~lib/rt/itcms/Object#unlink
  global.get $~lib/rt/itcms/toSpace
  local.set $1
  local.get $0
  i32.load offset=12
  local.tee $2
  i32.const 2
  i32.le_u
  if (result i32)
   i32.const 1
  else
   local.get $2
   i32.const 1856
   i32.load
   i32.gt_u
   if
    i32.const 1536
    i32.const 1600
    i32.const 21
    i32.const 28
    call $~lib/builtins/abort
    unreachable
   end
   local.get $2
   i32.const 2
   i32.shl
   i32.const 1860
   i32.add
   i32.load
   i32.const 32
   i32.and
  end
  local.set $3
  local.get $1
  i32.load offset=8
  local.set $2
  local.get $0
  global.get $~lib/rt/itcms/white
  i32.eqz
  i32.const 2
  local.get $3
  select
  local.get $1
  i32.or
  i32.store offset=4
  local.get $0
  local.get $2
  i32.store offset=8
  local.get $2
  local.get $0
  local.get $2
  i32.load offset=4
  i32.const 3
  i32.and
  i32.or
  i32.store offset=4
  local.get $1
  local.get $0
  i32.store offset=8
 )
 (func $~lib/rt/itcms/__visit (param $0 i32)
  local.get $0
  i32.eqz
  if
   return
  end
  global.get $~lib/rt/itcms/white
  local.get $0
  i32.const 20
  i32.sub
  local.tee $0
  i32.load offset=4
  i32.const 3
  i32.and
  i32.eq
  if
   local.get $0
   call $~lib/rt/itcms/Object#makeGray
   global.get $~lib/rt/itcms/visitCount
   i32.const 1
   i32.add
   global.set $~lib/rt/itcms/visitCount
  end
 )
 (func $~lib/rt/tlsf/removeBlock (param $0 i32) (param $1 i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  local.get $1
  i32.load
  local.tee $3
  i32.const 1
  i32.and
  i32.eqz
  if
   i32.const 0
   i32.const 1680
   i32.const 268
   i32.const 14
   call $~lib/builtins/abort
   unreachable
  end
  local.get $3
  i32.const -4
  i32.and
  local.tee $3
  i32.const 12
  i32.lt_u
  if
   i32.const 0
   i32.const 1680
   i32.const 270
   i32.const 14
   call $~lib/builtins/abort
   unreachable
  end
  local.get $3
  i32.const 256
  i32.lt_u
  if (result i32)
   local.get $3
   i32.const 4
   i32.shr_u
  else
   i32.const 31
   i32.const 1073741820
   local.get $3
   local.get $3
   i32.const 1073741820
   i32.ge_u
   select
   local.tee $3
   i32.clz
   i32.sub
   local.tee $4
   i32.const 7
   i32.sub
   local.set $2
   local.get $3
   local.get $4
   i32.const 4
   i32.sub
   i32.shr_u
   i32.const 16
   i32.xor
  end
  local.tee $3
  i32.const 16
  i32.lt_u
  local.get $2
  i32.const 23
  i32.lt_u
  i32.and
  i32.eqz
  if
   i32.const 0
   i32.const 1680
   i32.const 284
   i32.const 14
   call $~lib/builtins/abort
   unreachable
  end
  local.get $1
  i32.load offset=8
  local.set $5
  local.get $1
  i32.load offset=4
  local.tee $4
  if
   local.get $4
   local.get $5
   i32.store offset=8
  end
  local.get $5
  if
   local.get $5
   local.get $4
   i32.store offset=4
  end
  local.get $1
  local.get $0
  local.get $2
  i32.const 4
  i32.shl
  local.get $3
  i32.add
  i32.const 2
  i32.shl
  i32.add
  local.tee $1
  i32.load offset=96
  i32.eq
  if
   local.get $1
   local.get $5
   i32.store offset=96
   local.get $5
   i32.eqz
   if
    local.get $0
    local.get $2
    i32.const 2
    i32.shl
    i32.add
    local.tee $1
    i32.load offset=4
    i32.const -2
    local.get $3
    i32.rotl
    i32.and
    local.set $3
    local.get $1
    local.get $3
    i32.store offset=4
    local.get $3
    i32.eqz
    if
     local.get $0
     local.get $0
     i32.load
     i32.const -2
     local.get $2
     i32.rotl
     i32.and
     i32.store
    end
   end
  end
 )
 (func $~lib/rt/tlsf/insertBlock (param $0 i32) (param $1 i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  local.get $1
  i32.eqz
  if
   i32.const 0
   i32.const 1680
   i32.const 201
   i32.const 14
   call $~lib/builtins/abort
   unreachable
  end
  local.get $1
  i32.load
  local.tee $3
  i32.const 1
  i32.and
  i32.eqz
  if
   i32.const 0
   i32.const 1680
   i32.const 203
   i32.const 14
   call $~lib/builtins/abort
   unreachable
  end
  local.get $1
  i32.const 4
  i32.add
  local.get $1
  i32.load
  i32.const -4
  i32.and
  i32.add
  local.tee $4
  i32.load
  local.tee $2
  i32.const 1
  i32.and
  if
   local.get $0
   local.get $4
   call $~lib/rt/tlsf/removeBlock
   local.get $1
   local.get $3
   i32.const 4
   i32.add
   local.get $2
   i32.const -4
   i32.and
   i32.add
   local.tee $3
   i32.store
   local.get $1
   i32.const 4
   i32.add
   local.get $1
   i32.load
   i32.const -4
   i32.and
   i32.add
   local.tee $4
   i32.load
   local.set $2
  end
  local.get $3
  i32.const 2
  i32.and
  if
   local.get $1
   i32.const 4
   i32.sub
   i32.load
   local.tee $1
   i32.load
   local.tee $6
   i32.const 1
   i32.and
   i32.eqz
   if
    i32.const 0
    i32.const 1680
    i32.const 221
    i32.const 16
    call $~lib/builtins/abort
    unreachable
   end
   local.get $0
   local.get $1
   call $~lib/rt/tlsf/removeBlock
   local.get $1
   local.get $6
   i32.const 4
   i32.add
   local.get $3
   i32.const -4
   i32.and
   i32.add
   local.tee $3
   i32.store
  end
  local.get $4
  local.get $2
  i32.const 2
  i32.or
  i32.store
  local.get $3
  i32.const -4
  i32.and
  local.tee $2
  i32.const 12
  i32.lt_u
  if
   i32.const 0
   i32.const 1680
   i32.const 233
   i32.const 14
   call $~lib/builtins/abort
   unreachable
  end
  local.get $4
  local.get $1
  i32.const 4
  i32.add
  local.get $2
  i32.add
  i32.ne
  if
   i32.const 0
   i32.const 1680
   i32.const 234
   i32.const 14
   call $~lib/builtins/abort
   unreachable
  end
  local.get $4
  i32.const 4
  i32.sub
  local.get $1
  i32.store
  local.get $2
  i32.const 256
  i32.lt_u
  if (result i32)
   local.get $2
   i32.const 4
   i32.shr_u
  else
   i32.const 31
   i32.const 1073741820
   local.get $2
   local.get $2
   i32.const 1073741820
   i32.ge_u
   select
   local.tee $2
   i32.clz
   i32.sub
   local.tee $3
   i32.const 7
   i32.sub
   local.set $5
   local.get $2
   local.get $3
   i32.const 4
   i32.sub
   i32.shr_u
   i32.const 16
   i32.xor
  end
  local.tee $2
  i32.const 16
  i32.lt_u
  local.get $5
  i32.const 23
  i32.lt_u
  i32.and
  i32.eqz
  if
   i32.const 0
   i32.const 1680
   i32.const 251
   i32.const 14
   call $~lib/builtins/abort
   unreachable
  end
  local.get $0
  local.get $5
  i32.const 4
  i32.shl
  local.get $2
  i32.add
  i32.const 2
  i32.shl
  i32.add
  i32.load offset=96
  local.set $3
  local.get $1
  i32.const 0
  i32.store offset=4
  local.get $1
  local.get $3
  i32.store offset=8
  local.get $3
  if
   local.get $3
   local.get $1
   i32.store offset=4
  end
  local.get $0
  local.get $5
  i32.const 4
  i32.shl
  local.get $2
  i32.add
  i32.const 2
  i32.shl
  i32.add
  local.get $1
  i32.store offset=96
  local.get $0
  local.get $0
  i32.load
  i32.const 1
  local.get $5
  i32.shl
  i32.or
  i32.store
  local.get $0
  local.get $5
  i32.const 2
  i32.shl
  i32.add
  local.tee $0
  local.get $0
  i32.load offset=4
  i32.const 1
  local.get $2
  i32.shl
  i32.or
  i32.store offset=4
 )
 (func $~lib/rt/tlsf/addMemory (param $0 i32) (param $1 i32) (param $2 i64)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  local.get $2
  local.get $1
  i64.extend_i32_u
  i64.lt_u
  if
   i32.const 0
   i32.const 1680
   i32.const 382
   i32.const 14
   call $~lib/builtins/abort
   unreachable
  end
  local.get $1
  i32.const 19
  i32.add
  i32.const -16
  i32.and
  i32.const 4
  i32.sub
  local.set $1
  local.get $0
  i32.load offset=1568
  local.tee $3
  if
   local.get $3
   i32.const 4
   i32.add
   local.get $1
   i32.gt_u
   if
    i32.const 0
    i32.const 1680
    i32.const 389
    i32.const 16
    call $~lib/builtins/abort
    unreachable
   end
   local.get $3
   local.get $1
   i32.const 16
   i32.sub
   local.tee $5
   i32.eq
   if
    local.get $3
    i32.load
    local.set $4
    local.get $5
    local.set $1
   end
  else
   local.get $0
   i32.const 1572
   i32.add
   local.get $1
   i32.gt_u
   if
    i32.const 0
    i32.const 1680
    i32.const 402
    i32.const 5
    call $~lib/builtins/abort
    unreachable
   end
  end
  local.get $2
  i32.wrap_i64
  i32.const -16
  i32.and
  local.get $1
  i32.sub
  local.tee $3
  i32.const 20
  i32.lt_u
  if
   return
  end
  local.get $1
  local.get $4
  i32.const 2
  i32.and
  local.get $3
  i32.const 8
  i32.sub
  local.tee $3
  i32.const 1
  i32.or
  i32.or
  i32.store
  local.get $1
  i32.const 0
  i32.store offset=4
  local.get $1
  i32.const 0
  i32.store offset=8
  local.get $1
  i32.const 4
  i32.add
  local.get $3
  i32.add
  local.tee $3
  i32.const 2
  i32.store
  local.get $0
  local.get $3
  i32.store offset=1568
  local.get $0
  local.get $1
  call $~lib/rt/tlsf/insertBlock
 )
 (func $~lib/rt/tlsf/initialize
  (local $0 i32)
  (local $1 i32)
  memory.size
  local.tee $1
  i32.const 0
  i32.le_s
  if (result i32)
   i32.const 1
   local.get $1
   i32.sub
   memory.grow
   i32.const 0
   i32.lt_s
  else
   i32.const 0
  end
  if
   unreachable
  end
  i32.const 34656
  i32.const 0
  i32.store
  i32.const 36224
  i32.const 0
  i32.store
  loop $for-loop|0
   local.get $0
   i32.const 23
   i32.lt_u
   if
    local.get $0
    i32.const 2
    i32.shl
    i32.const 34656
    i32.add
    i32.const 0
    i32.store offset=4
    i32.const 0
    local.set $1
    loop $for-loop|1
     local.get $1
     i32.const 16
     i32.lt_u
     if
      local.get $0
      i32.const 4
      i32.shl
      local.get $1
      i32.add
      i32.const 2
      i32.shl
      i32.const 34656
      i32.add
      i32.const 0
      i32.store offset=96
      local.get $1
      i32.const 1
      i32.add
      local.set $1
      br $for-loop|1
     end
    end
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|0
   end
  end
  i32.const 34656
  i32.const 36228
  memory.size
  i64.extend_i32_s
  i64.const 16
  i64.shl
  call $~lib/rt/tlsf/addMemory
  i32.const 34656
  global.set $~lib/rt/tlsf/ROOT
 )
 (func $~lib/rt/itcms/step (result i32)
  (local $0 i32)
  (local $1 i32)
  (local $2 i32)
  block $break|0
   block $case2|0
    block $case1|0
     block $case0|0
      global.get $~lib/rt/itcms/state
      br_table $case0|0 $case1|0 $case2|0 $break|0
     end
     i32.const 1
     global.set $~lib/rt/itcms/state
     i32.const 0
     global.set $~lib/rt/itcms/visitCount
     call $~lib/rt/itcms/visitRoots
     global.get $~lib/rt/itcms/toSpace
     global.set $~lib/rt/itcms/iter
     global.get $~lib/rt/itcms/visitCount
     return
    end
    global.get $~lib/rt/itcms/white
    i32.eqz
    local.set $1
    global.get $~lib/rt/itcms/iter
    i32.load offset=4
    i32.const -4
    i32.and
    local.set $0
    loop $while-continue|1
     local.get $0
     global.get $~lib/rt/itcms/toSpace
     i32.ne
     if
      local.get $0
      global.set $~lib/rt/itcms/iter
      local.get $1
      local.get $0
      i32.load offset=4
      local.tee $2
      i32.const 3
      i32.and
      i32.ne
      if
       local.get $0
       local.get $2
       i32.const -4
       i32.and
       local.get $1
       i32.or
       i32.store offset=4
       i32.const 0
       global.set $~lib/rt/itcms/visitCount
       local.get $0
       i32.const 20
       i32.add
       call $~lib/rt/__visit_members
       global.get $~lib/rt/itcms/visitCount
       return
      end
      local.get $0
      i32.load offset=4
      i32.const -4
      i32.and
      local.set $0
      br $while-continue|1
     end
    end
    i32.const 0
    global.set $~lib/rt/itcms/visitCount
    call $~lib/rt/itcms/visitRoots
    global.get $~lib/rt/itcms/toSpace
    global.get $~lib/rt/itcms/iter
    i32.load offset=4
    i32.const -4
    i32.and
    i32.eq
    if
     i32.const 34644
     local.set $0
     loop $while-continue|0
      local.get $0
      i32.const 34644
      i32.lt_u
      if
       local.get $0
       i32.load
       call $~lib/rt/itcms/__visit
       local.get $0
       i32.const 4
       i32.add
       local.set $0
       br $while-continue|0
      end
     end
     global.get $~lib/rt/itcms/iter
     i32.load offset=4
     i32.const -4
     i32.and
     local.set $0
     loop $while-continue|2
      local.get $0
      global.get $~lib/rt/itcms/toSpace
      i32.ne
      if
       local.get $1
       local.get $0
       i32.load offset=4
       local.tee $2
       i32.const 3
       i32.and
       i32.ne
       if
        local.get $0
        local.get $2
        i32.const -4
        i32.and
        local.get $1
        i32.or
        i32.store offset=4
        local.get $0
        i32.const 20
        i32.add
        call $~lib/rt/__visit_members
       end
       local.get $0
       i32.load offset=4
       i32.const -4
       i32.and
       local.set $0
       br $while-continue|2
      end
     end
     global.get $~lib/rt/itcms/fromSpace
     local.set $0
     global.get $~lib/rt/itcms/toSpace
     global.set $~lib/rt/itcms/fromSpace
     local.get $0
     global.set $~lib/rt/itcms/toSpace
     local.get $1
     global.set $~lib/rt/itcms/white
     local.get $0
     i32.load offset=4
     i32.const -4
     i32.and
     global.set $~lib/rt/itcms/iter
     i32.const 2
     global.set $~lib/rt/itcms/state
    end
    global.get $~lib/rt/itcms/visitCount
    return
   end
   global.get $~lib/rt/itcms/iter
   local.tee $0
   global.get $~lib/rt/itcms/toSpace
   i32.ne
   if
    local.get $0
    i32.load offset=4
    local.tee $1
    i32.const -4
    i32.and
    global.set $~lib/rt/itcms/iter
    global.get $~lib/rt/itcms/white
    i32.eqz
    local.get $1
    i32.const 3
    i32.and
    i32.ne
    if
     i32.const 0
     i32.const 1408
     i32.const 229
     i32.const 20
     call $~lib/builtins/abort
     unreachable
    end
    local.get $0
    i32.const 34644
    i32.lt_u
    if
     local.get $0
     i32.const 0
     i32.store offset=4
     local.get $0
     i32.const 0
     i32.store offset=8
    else
     global.get $~lib/rt/itcms/total
     local.get $0
     i32.load
     i32.const -4
     i32.and
     i32.const 4
     i32.add
     i32.sub
     global.set $~lib/rt/itcms/total
     local.get $0
     i32.const 4
     i32.add
     local.tee $0
     i32.const 34644
     i32.ge_u
     if
      global.get $~lib/rt/tlsf/ROOT
      i32.eqz
      if
       call $~lib/rt/tlsf/initialize
      end
      global.get $~lib/rt/tlsf/ROOT
      local.set $1
      local.get $0
      i32.const 4
      i32.sub
      local.set $2
      local.get $0
      i32.const 15
      i32.and
      i32.const 1
      local.get $0
      select
      if (result i32)
       i32.const 1
      else
       local.get $2
       i32.load
       i32.const 1
       i32.and
      end
      if
       i32.const 0
       i32.const 1680
       i32.const 562
       i32.const 3
       call $~lib/builtins/abort
       unreachable
      end
      local.get $2
      local.get $2
      i32.load
      i32.const 1
      i32.or
      i32.store
      local.get $1
      local.get $2
      call $~lib/rt/tlsf/insertBlock
     end
    end
    i32.const 10
    return
   end
   global.get $~lib/rt/itcms/toSpace
   global.get $~lib/rt/itcms/toSpace
   i32.store offset=4
   global.get $~lib/rt/itcms/toSpace
   global.get $~lib/rt/itcms/toSpace
   i32.store offset=8
   i32.const 0
   global.set $~lib/rt/itcms/state
  end
  i32.const 0
 )
 (func $~lib/rt/tlsf/searchBlock (param $0 i32) (param $1 i32) (result i32)
  (local $2 i32)
  local.get $1
  i32.const 256
  i32.lt_u
  if
   local.get $1
   i32.const 4
   i32.shr_u
   local.set $1
  else
   local.get $1
   i32.const 536870910
   i32.lt_u
   if
    local.get $1
    i32.const 1
    i32.const 27
    local.get $1
    i32.clz
    i32.sub
    i32.shl
    i32.add
    i32.const 1
    i32.sub
    local.set $1
   end
   local.get $1
   i32.const 31
   local.get $1
   i32.clz
   i32.sub
   local.tee $2
   i32.const 4
   i32.sub
   i32.shr_u
   i32.const 16
   i32.xor
   local.set $1
   local.get $2
   i32.const 7
   i32.sub
   local.set $2
  end
  local.get $1
  i32.const 16
  i32.lt_u
  local.get $2
  i32.const 23
  i32.lt_u
  i32.and
  i32.eqz
  if
   i32.const 0
   i32.const 1680
   i32.const 334
   i32.const 14
   call $~lib/builtins/abort
   unreachable
  end
  local.get $0
  local.get $2
  i32.const 2
  i32.shl
  i32.add
  i32.load offset=4
  i32.const -1
  local.get $1
  i32.shl
  i32.and
  local.tee $1
  if (result i32)
   local.get $0
   local.get $1
   i32.ctz
   local.get $2
   i32.const 4
   i32.shl
   i32.add
   i32.const 2
   i32.shl
   i32.add
   i32.load offset=96
  else
   local.get $0
   i32.load
   i32.const -1
   local.get $2
   i32.const 1
   i32.add
   i32.shl
   i32.and
   local.tee $1
   if (result i32)
    local.get $0
    local.get $1
    i32.ctz
    local.tee $1
    i32.const 2
    i32.shl
    i32.add
    i32.load offset=4
    local.tee $2
    i32.eqz
    if
     i32.const 0
     i32.const 1680
     i32.const 347
     i32.const 18
     call $~lib/builtins/abort
     unreachable
    end
    local.get $0
    local.get $2
    i32.ctz
    local.get $1
    i32.const 4
    i32.shl
    i32.add
    i32.const 2
    i32.shl
    i32.add
    i32.load offset=96
   else
    i32.const 0
   end
  end
 )
 (func $~lib/rt/itcms/__new (param $0 i32) (param $1 i32) (result i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  local.get $0
  i32.const 1073741804
  i32.ge_u
  if
   i32.const 1344
   i32.const 1408
   i32.const 261
   i32.const 31
   call $~lib/builtins/abort
   unreachable
  end
  global.get $~lib/rt/itcms/total
  global.get $~lib/rt/itcms/threshold
  i32.ge_u
  if
   block $__inlined_func$~lib/rt/itcms/interrupt$70
    i32.const 2048
    local.set $2
    loop $do-loop|0
     local.get $2
     call $~lib/rt/itcms/step
     i32.sub
     local.set $2
     global.get $~lib/rt/itcms/state
     i32.eqz
     if
      global.get $~lib/rt/itcms/total
      i64.extend_i32_u
      i64.const 200
      i64.mul
      i64.const 100
      i64.div_u
      i32.wrap_i64
      i32.const 1024
      i32.add
      global.set $~lib/rt/itcms/threshold
      br $__inlined_func$~lib/rt/itcms/interrupt$70
     end
     local.get $2
     i32.const 0
     i32.gt_s
     br_if $do-loop|0
    end
    global.get $~lib/rt/itcms/total
    global.get $~lib/rt/itcms/total
    global.get $~lib/rt/itcms/threshold
    i32.sub
    i32.const 1024
    i32.lt_u
    i32.const 10
    i32.shl
    i32.add
    global.set $~lib/rt/itcms/threshold
   end
  end
  global.get $~lib/rt/tlsf/ROOT
  i32.eqz
  if
   call $~lib/rt/tlsf/initialize
  end
  global.get $~lib/rt/tlsf/ROOT
  local.set $4
  local.get $0
  i32.const 16
  i32.add
  local.tee $2
  i32.const 1073741820
  i32.gt_u
  if
   i32.const 1344
   i32.const 1680
   i32.const 461
   i32.const 29
   call $~lib/builtins/abort
   unreachable
  end
  local.get $4
  local.get $2
  i32.const 12
  i32.le_u
  if (result i32)
   i32.const 12
  else
   local.get $2
   i32.const 19
   i32.add
   i32.const -16
   i32.and
   i32.const 4
   i32.sub
  end
  local.tee $5
  call $~lib/rt/tlsf/searchBlock
  local.tee $2
  i32.eqz
  if
   memory.size
   local.tee $2
   local.get $5
   i32.const 256
   i32.ge_u
   if (result i32)
    local.get $5
    i32.const 536870910
    i32.lt_u
    if (result i32)
     local.get $5
     i32.const 1
     i32.const 27
     local.get $5
     i32.clz
     i32.sub
     i32.shl
     i32.add
     i32.const 1
     i32.sub
    else
     local.get $5
    end
   else
    local.get $5
   end
   i32.const 4
   local.get $4
   i32.load offset=1568
   local.get $2
   i32.const 16
   i32.shl
   i32.const 4
   i32.sub
   i32.ne
   i32.shl
   i32.add
   i32.const 65535
   i32.add
   i32.const -65536
   i32.and
   i32.const 16
   i32.shr_u
   local.tee $3
   local.get $2
   local.get $3
   i32.gt_s
   select
   memory.grow
   i32.const 0
   i32.lt_s
   if
    local.get $3
    memory.grow
    i32.const 0
    i32.lt_s
    if
     unreachable
    end
   end
   local.get $4
   local.get $2
   i32.const 16
   i32.shl
   memory.size
   i64.extend_i32_s
   i64.const 16
   i64.shl
   call $~lib/rt/tlsf/addMemory
   local.get $4
   local.get $5
   call $~lib/rt/tlsf/searchBlock
   local.tee $2
   i32.eqz
   if
    i32.const 0
    i32.const 1680
    i32.const 499
    i32.const 16
    call $~lib/builtins/abort
    unreachable
   end
  end
  local.get $5
  local.get $2
  i32.load
  i32.const -4
  i32.and
  i32.gt_u
  if
   i32.const 0
   i32.const 1680
   i32.const 501
   i32.const 14
   call $~lib/builtins/abort
   unreachable
  end
  local.get $4
  local.get $2
  call $~lib/rt/tlsf/removeBlock
  local.get $2
  i32.load
  local.set $6
  local.get $5
  i32.const 4
  i32.add
  i32.const 15
  i32.and
  if
   i32.const 0
   i32.const 1680
   i32.const 361
   i32.const 14
   call $~lib/builtins/abort
   unreachable
  end
  local.get $6
  i32.const -4
  i32.and
  local.get $5
  i32.sub
  local.tee $3
  i32.const 16
  i32.ge_u
  if
   local.get $2
   local.get $5
   local.get $6
   i32.const 2
   i32.and
   i32.or
   i32.store
   local.get $2
   i32.const 4
   i32.add
   local.get $5
   i32.add
   local.tee $5
   local.get $3
   i32.const 4
   i32.sub
   i32.const 1
   i32.or
   i32.store
   local.get $4
   local.get $5
   call $~lib/rt/tlsf/insertBlock
  else
   local.get $2
   local.get $6
   i32.const -2
   i32.and
   i32.store
   local.get $2
   i32.const 4
   i32.add
   local.get $2
   i32.load
   i32.const -4
   i32.and
   i32.add
   local.tee $3
   local.get $3
   i32.load
   i32.const -3
   i32.and
   i32.store
  end
  local.get $2
  local.get $1
  i32.store offset=12
  local.get $2
  local.get $0
  i32.store offset=16
  global.get $~lib/rt/itcms/fromSpace
  local.tee $1
  i32.load offset=8
  local.set $3
  local.get $2
  local.get $1
  global.get $~lib/rt/itcms/white
  i32.or
  i32.store offset=4
  local.get $2
  local.get $3
  i32.store offset=8
  local.get $3
  local.get $2
  local.get $3
  i32.load offset=4
  i32.const 3
  i32.and
  i32.or
  i32.store offset=4
  local.get $1
  local.get $2
  i32.store offset=8
  global.get $~lib/rt/itcms/total
  local.get $2
  i32.load
  i32.const -4
  i32.and
  i32.const 4
  i32.add
  i32.add
  global.set $~lib/rt/itcms/total
  local.get $2
  i32.const 20
  i32.add
  local.tee $1
  i32.const 0
  local.get $0
  memory.fill
  local.get $1
 )
 (func $~lib/rt/itcms/__pin (param $0 i32) (result i32)
  (local $1 i32)
  (local $2 i32)
  (local $3 i32)
  local.get $0
  if
   local.get $0
   i32.const 20
   i32.sub
   local.tee $1
   i32.load offset=4
   i32.const 3
   i32.and
   i32.const 3
   i32.eq
   if
    i32.const 1744
    i32.const 1408
    i32.const 338
    i32.const 7
    call $~lib/builtins/abort
    unreachable
   end
   local.get $1
   call $~lib/rt/itcms/Object#unlink
   global.get $~lib/rt/itcms/pinSpace
   local.tee $3
   i32.load offset=8
   local.set $2
   local.get $1
   local.get $3
   i32.const 3
   i32.or
   i32.store offset=4
   local.get $1
   local.get $2
   i32.store offset=8
   local.get $2
   local.get $1
   local.get $2
   i32.load offset=4
   i32.const 3
   i32.and
   i32.or
   i32.store offset=4
   local.get $3
   local.get $1
   i32.store offset=8
  end
  local.get $0
 )
 (func $~lib/rt/itcms/__unpin (param $0 i32)
  (local $1 i32)
  (local $2 i32)
  local.get $0
  i32.eqz
  if
   return
  end
  local.get $0
  i32.const 20
  i32.sub
  local.tee $1
  i32.load offset=4
  i32.const 3
  i32.and
  i32.const 3
  i32.ne
  if
   i32.const 1808
   i32.const 1408
   i32.const 352
   i32.const 5
   call $~lib/builtins/abort
   unreachable
  end
  global.get $~lib/rt/itcms/state
  i32.const 1
  i32.eq
  if
   local.get $1
   call $~lib/rt/itcms/Object#makeGray
  else
   local.get $1
   call $~lib/rt/itcms/Object#unlink
   global.get $~lib/rt/itcms/fromSpace
   local.tee $0
   i32.load offset=8
   local.set $2
   local.get $1
   local.get $0
   global.get $~lib/rt/itcms/white
   i32.or
   i32.store offset=4
   local.get $1
   local.get $2
   i32.store offset=8
   local.get $2
   local.get $1
   local.get $2
   i32.load offset=4
   i32.const 3
   i32.and
   i32.or
   i32.store offset=4
   local.get $0
   local.get $1
   i32.store offset=8
  end
 )
 (func $~lib/rt/itcms/__collect
  global.get $~lib/rt/itcms/state
  i32.const 0
  i32.gt_s
  if
   loop $while-continue|0
    global.get $~lib/rt/itcms/state
    if
     call $~lib/rt/itcms/step
     drop
     br $while-continue|0
    end
   end
  end
  call $~lib/rt/itcms/step
  drop
  loop $while-continue|1
   global.get $~lib/rt/itcms/state
   if
    call $~lib/rt/itcms/step
    drop
    br $while-continue|1
   end
  end
  global.get $~lib/rt/itcms/total
  i64.extend_i32_u
  i64.const 200
  i64.mul
  i64.const 100
  i64.div_u
  i32.wrap_i64
  i32.const 1024
  i32.add
  global.set $~lib/rt/itcms/threshold
 )
 (func $~lib/rt/__visit_members (param $0 i32)
  block $invalid
   block $~lib/arraybuffer/ArrayBufferView
    block $~lib/string/String
     block $~lib/arraybuffer/ArrayBuffer
      block $~lib/object/Object
       local.get $0
       i32.const 8
       i32.sub
       i32.load
       br_table $~lib/object/Object $~lib/arraybuffer/ArrayBuffer $~lib/string/String $~lib/arraybuffer/ArrayBufferView $invalid
      end
      return
     end
     return
    end
    return
   end
   local.get $0
   i32.load
   local.tee $0
   if
    local.get $0
    call $~lib/rt/itcms/__visit
   end
   return
  end
  unreachable
 )
 (func $~start
  memory.size
  i32.const 16
  i32.shl
  i32.const 34644
  i32.sub
  i32.const 1
  i32.shr_u
  global.set $~lib/rt/itcms/threshold
  i32.const 1460
  i32.const 1456
  i32.store
  i32.const 1464
  i32.const 1456
  i32.store
  i32.const 1456
  global.set $~lib/rt/itcms/pinSpace
  i32.const 1492
  i32.const 1488
  i32.store
  i32.const 1496
  i32.const 1488
  i32.store
  i32.const 1488
  global.set $~lib/rt/itcms/toSpace
  i32.const 1636
  i32.const 1632
  i32.store
  i32.const 1640
  i32.const 1632
  i32.store
  i32.const 1632
  global.set $~lib/rt/itcms/fromSpace
 )
)
