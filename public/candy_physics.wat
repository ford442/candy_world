(module
 (type $0 (func (result f32)))
 (type $1 (func (param f32 f32 f32)))
 (type $2 (func (param f32 f32 f32) (result f32)))
 (type $3 (func (param f32) (result f32)))
 (type $4 (func (param f32 f32 f32 f32) (result f32)))
 (type $5 (func (param f32 f32) (result f32)))
 (type $6 (func (param f32 f32 f32 i32) (result i32)))
 (type $7 (func (param f32 f32 f32 f32 i32) (result i32)))
 (type $8 (func (param f32 f32 f32 i32)))
 (type $9 (func (param f32 f32 f32 i32 i32)))
 (type $10 (func (param f32 f32 f32 f32)))
 (type $11 (func (param f32 f32 f32 f32 i32)))
 (type $12 (func (param i32 i32 f32) (result i32)))
 (type $13 (func (param f32 f32 f32 f32 f32 f32)))
 (global $assembly/index/wobbleResultX (mut f32) (f32.const 0))
 (global $assembly/index/wobbleResultZ (mut f32) (f32.const 0))
 (global $assembly/index/speakerYOffset (mut f32) (f32.const 0))
 (global $assembly/index/speakerScaleX (mut f32) (f32.const 1))
 (global $assembly/index/speakerScaleY (mut f32) (f32.const 1))
 (global $assembly/index/speakerScaleZ (mut f32) (f32.const 1))
 (global $assembly/index/accordionStretchY (mut f32) (f32.const 1))
 (global $assembly/index/accordionWidthXZ (mut f32) (f32.const 1))
 (global $assembly/index/fiberBaseRotY (mut f32) (f32.const 0))
 (global $assembly/index/fiberBranchRotZ (mut f32) (f32.const 0))
 (global $assembly/index/shiverRotX (mut f32) (f32.const 0))
 (global $assembly/index/shiverRotZ (mut f32) (f32.const 0))
 (global $assembly/index/spiralRotY (mut f32) (f32.const 0))
 (global $assembly/index/spiralYOffset (mut f32) (f32.const 0))
 (global $assembly/index/spiralScale (mut f32) (f32.const 1))
 (global $assembly/index/prismUnfurl (mut f32) (f32.const 0))
 (global $assembly/index/prismSpin (mut f32) (f32.const 0))
 (global $assembly/index/prismPulse (mut f32) (f32.const 1))
 (global $assembly/index/prismHue (mut f32) (f32.const 0))
 (global $assembly/index/particleX (mut f32) (f32.const 0))
 (global $assembly/index/particleY (mut f32) (f32.const 0))
 (global $assembly/index/particleZ (mut f32) (f32.const 0))
 (global $~lib/math/rempio2f_y (mut f64) (f64.const 0))
 (memory $0 1)
 (data $0 (i32.const 1024) ")\15DNn\83\f9\a2\c0\dd4\f5\d1W\'\fcA\90C<\99\95b\dba\c5\bb\de\abcQ\fe")
 (data $1 (i32.const 1056) "\be\f3\f8y\eca\f6?\190\96[\c6\fe\de\bf=\88\afJ\edq\f5?\a4\fc\d42h\0b\db\bf\b0\10\f0\f09\95\f4?{\b7\1f\n\8bA\d7\bf\85\03\b8\b0\95\c9\f3?{\cfm\1a\e9\9d\d3\bf\a5d\88\0c\19\r\f3?1\b6\f2\f3\9b\1d\d0\bf\a0\8e\0b{\"^\f2?\f0z;\1b\1d|\c9\bf?4\1aJJ\bb\f1?\9f<\af\93\e3\f9\c2\bf\ba\e5\8a\f0X#\f1?\\\8dx\bf\cb`\b9\bf\a7\00\99A?\95\f0?\ce_G\b6\9do\aa\bf\00\00\00\00\00\00\f0?\00\00\00\00\00\00\00\00\acG\9a\fd\8c`\ee?=\f5$\9f\ca8\b3?\a0j\02\1f\b3\a4\ec?\ba\918T\a9v\c4?\e6\fcjW6 \eb?\d2\e4\c4J\0b\84\ce?-\aa\a1c\d1\c2\e9?\1ce\c6\f0E\06\d4?\edAx\03\e6\86\e8?\f8\9f\1b,\9c\8e\d8?bHS\f5\dcg\e7?\cc{\b1N\a4\e0\dc?")
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
 (export "calcSpeakerPulse" (func $assembly/index/calcSpeakerPulse))
 (export "getSpeakerYOffset" (func $assembly/index/getSpeakerYOffset))
 (export "getSpeakerScaleX" (func $assembly/index/getSpeakerScaleX))
 (export "getSpeakerScaleY" (func $assembly/index/getSpeakerScaleY))
 (export "getSpeakerScaleZ" (func $assembly/index/getSpeakerScaleZ))
 (export "calcAccordionStretch" (func $assembly/index/calcAccordionStretch))
 (export "getAccordionStretchY" (func $assembly/index/getAccordionStretchY))
 (export "getAccordionWidthXZ" (func $assembly/index/getAccordionWidthXZ))
 (export "calcFiberWhip" (func $assembly/index/calcFiberWhip))
 (export "getFiberBaseRotY" (func $assembly/index/getFiberBaseRotY))
 (export "getFiberBranchRotZ" (func $assembly/index/getFiberBranchRotZ))
 (export "calcHopY" (func $assembly/index/calcHopY))
 (export "calcShiver" (func $assembly/index/calcShiver))
 (export "getShiverRotX" (func $assembly/index/getShiverRotX))
 (export "getShiverRotZ" (func $assembly/index/getShiverRotZ))
 (export "calcSpiralWave" (func $assembly/index/calcSpiralWave))
 (export "getSpiralRotY" (func $assembly/index/getSpiralRotY))
 (export "getSpiralYOffset" (func $assembly/index/getSpiralYOffset))
 (export "getSpiralScale" (func $assembly/index/getSpiralScale))
 (export "calcPrismRose" (func $assembly/index/calcPrismRose))
 (export "getPrismUnfurl" (func $assembly/index/getPrismUnfurl))
 (export "getPrismSpin" (func $assembly/index/getPrismSpin))
 (export "getPrismPulse" (func $assembly/index/getPrismPulse))
 (export "getPrismHue" (func $assembly/index/getPrismHue))
 (export "lerpColor" (func $assembly/index/lerpColor))
 (export "calcRainDropY" (func $assembly/index/calcRainDropY))
 (export "calcFloatingParticle" (func $assembly/index/calcFloatingParticle))
 (export "getParticleX" (func $assembly/index/getParticleX))
 (export "getParticleY" (func $assembly/index/getParticleY))
 (export "getParticleZ" (func $assembly/index/getParticleZ))
 (export "memory" (memory $0))
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
 (func $~lib/math/NativeMathf.mod (param $0 f32) (param $1 f32) (result f32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  local.get $1
  f32.abs
  f32.const 1
  f32.eq
  if
   local.get $0
   local.get $0
   f32.trunc
   f32.sub
   local.get $0
   f32.copysign
   return
  end
  local.get $1
  i32.reinterpret_f32
  local.tee $6
  i32.const 23
  i32.shr_u
  i32.const 255
  i32.and
  local.set $7
  local.get $6
  i32.const 1
  i32.shl
  local.tee $4
  i32.eqz
  local.get $0
  i32.reinterpret_f32
  local.tee $3
  i32.const 23
  i32.shr_u
  i32.const 255
  i32.and
  local.tee $8
  i32.const 255
  i32.eq
  i32.or
  local.get $1
  local.get $1
  f32.ne
  i32.or
  if
   local.get $0
   local.get $1
   f32.mul
   local.tee $0
   local.get $0
   f32.div
   return
  end
  local.get $3
  i32.const 1
  i32.shl
  local.tee $2
  local.get $4
  i32.le_u
  if
   local.get $0
   local.get $2
   local.get $4
   i32.ne
   f32.convert_i32_u
   f32.mul
   return
  end
  local.get $3
  i32.const -2147483648
  i32.and
  local.set $5
  local.get $8
  if (result i32)
   local.get $3
   i32.const 8388607
   i32.and
   i32.const 8388608
   i32.or
  else
   local.get $3
   i32.const 1
   local.get $8
   local.get $3
   i32.const 9
   i32.shl
   i32.clz
   i32.sub
   local.tee $8
   i32.sub
   i32.shl
  end
  local.set $2
  local.get $7
  if (result i32)
   local.get $6
   i32.const 8388607
   i32.and
   i32.const 8388608
   i32.or
  else
   local.get $6
   i32.const 1
   local.get $7
   local.get $6
   i32.const 9
   i32.shl
   i32.clz
   i32.sub
   local.tee $7
   i32.sub
   i32.shl
  end
  local.set $3
  loop $while-continue|0
   local.get $7
   local.get $8
   i32.lt_s
   if
    local.get $2
    local.get $3
    i32.ge_u
    if (result i32)
     local.get $2
     local.get $3
     i32.eq
     if
      local.get $0
      f32.const 0
      f32.mul
      return
     end
     local.get $2
     local.get $3
     i32.sub
    else
     local.get $2
    end
    i32.const 1
    i32.shl
    local.set $2
    local.get $8
    i32.const 1
    i32.sub
    local.set $8
    br $while-continue|0
   end
  end
  local.get $2
  local.get $3
  i32.ge_u
  if
   local.get $2
   local.get $3
   i32.eq
   if
    local.get $0
    f32.const 0
    f32.mul
    return
   end
   local.get $2
   local.get $3
   i32.sub
   local.set $2
  end
  local.get $8
  local.get $2
  i32.const 8
  i32.shl
  i32.clz
  local.tee $4
  i32.sub
  local.set $3
  local.get $2
  local.get $4
  i32.shl
  local.set $2
  local.get $3
  i32.const 0
  i32.gt_s
  if (result i32)
   local.get $2
   i32.const 8388608
   i32.sub
   local.get $3
   i32.const 23
   i32.shl
   i32.or
  else
   local.get $2
   i32.const 1
   local.get $3
   i32.sub
   i32.shr_u
  end
  local.get $5
  i32.or
  f32.reinterpret_i32
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
  f32.const 1
  call $~lib/math/NativeMathf.mod
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
 (func $assembly/index/calcSpeakerPulse (param $0 f32) (param $1 f32) (param $2 f32)
  local.get $0
  local.get $1
  f32.add
  call $~lib/math/NativeMathf.sin
  f32.const 0.20000000298023224
  f32.mul
  global.set $assembly/index/speakerYOffset
  local.get $2
  f32.const 0.5
  f32.mul
  local.tee $0
  f32.const 0.20000000298023224
  f32.mul
  f32.const 1
  f32.add
  local.tee $1
  global.set $assembly/index/speakerScaleX
  f32.const 1
  local.get $0
  f32.const 0.5
  f32.mul
  f32.sub
  global.set $assembly/index/speakerScaleY
  local.get $1
  global.set $assembly/index/speakerScaleZ
 )
 (func $assembly/index/getSpeakerYOffset (result f32)
  global.get $assembly/index/speakerYOffset
 )
 (func $assembly/index/getSpeakerScaleX (result f32)
  global.get $assembly/index/speakerScaleX
 )
 (func $assembly/index/getSpeakerScaleY (result f32)
  global.get $assembly/index/speakerScaleY
 )
 (func $assembly/index/getSpeakerScaleZ (result f32)
  global.get $assembly/index/speakerScaleZ
 )
 (func $assembly/index/calcAccordionStretch (param $0 f32) (param $1 f32) (param $2 f32)
  local.get $0
  f32.const 10
  f32.mul
  local.get $1
  f32.add
  call $~lib/math/NativeMathf.sin
  f32.const 0
  f32.max
  f32.const 0.30000001192092896
  f32.mul
  local.get $2
  f32.mul
  f32.const 1
  f32.add
  global.set $assembly/index/accordionStretchY
  f32.const 1
  global.get $assembly/index/accordionStretchY
  f32.sqrt
  f32.div
  global.set $assembly/index/accordionWidthXZ
 )
 (func $assembly/index/getAccordionStretchY (result f32)
  global.get $assembly/index/accordionStretchY
 )
 (func $assembly/index/getAccordionWidthXZ (result f32)
  global.get $assembly/index/accordionWidthXZ
 )
 (func $assembly/index/calcFiberWhip (param $0 f32) (param $1 f32) (param $2 f32) (param $3 i32) (param $4 i32)
  local.get $0
  f32.const 0.5
  f32.mul
  local.get $1
  f32.add
  call $~lib/math/NativeMathf.sin
  f32.const 0.10000000149011612
  f32.mul
  global.set $assembly/index/fiberBaseRotY
  local.get $0
  local.get $0
  f32.add
  local.get $4
  f32.convert_i32_s
  f32.const 0.5
  f32.mul
  local.tee $1
  f32.add
  call $~lib/math/NativeMathf.sin
  f32.const 0.10000000149011612
  f32.mul
  f32.const 0.785398006439209
  f32.add
  global.set $assembly/index/fiberBranchRotZ
  local.get $3
  if
   global.get $assembly/index/fiberBranchRotZ
   local.get $0
   f32.const 10
   f32.mul
   local.get $1
   f32.add
   call $~lib/math/NativeMathf.sin
   local.get $2
   local.get $2
   f32.add
   f32.mul
   f32.add
   global.set $assembly/index/fiberBranchRotZ
  end
 )
 (func $assembly/index/getFiberBaseRotY (result f32)
  global.get $assembly/index/fiberBaseRotY
 )
 (func $assembly/index/getFiberBranchRotZ (result f32)
  global.get $assembly/index/fiberBranchRotZ
 )
 (func $assembly/index/calcHopY (param $0 f32) (param $1 f32) (param $2 f32) (param $3 f32) (result f32)
  local.get $0
  local.get $1
  f32.add
  f32.const 4
  f32.mul
  call $~lib/math/NativeMathf.sin
  f32.const 0
  f32.max
  f32.const 0.30000001192092896
  f32.mul
  local.get $2
  f32.mul
  local.tee $0
  local.get $3
  f32.const 0.15000000596046448
  f32.mul
  f32.add
  local.get $0
  local.get $3
  f32.const 0.10000000149011612
  f32.gt
  select
 )
 (func $assembly/index/calcShiver (param $0 f32) (param $1 f32) (param $2 f32)
  local.get $0
  local.get $1
  f32.add
  f32.const 20
  f32.mul
  local.tee $0
  call $~lib/math/NativeMathf.sin
  f32.const 0.019999999552965164
  f32.mul
  local.get $2
  f32.mul
  global.set $assembly/index/shiverRotX
  local.get $0
  call $~lib/math/NativeMathf.cos
  f32.const 0.019999999552965164
  f32.mul
  local.get $2
  f32.mul
  global.set $assembly/index/shiverRotZ
 )
 (func $assembly/index/getShiverRotX (result f32)
  global.get $assembly/index/shiverRotX
 )
 (func $assembly/index/getShiverRotZ (result f32)
  global.get $assembly/index/shiverRotZ
 )
 (func $assembly/index/calcSpiralWave (param $0 f32) (param $1 f32) (param $2 f32) (param $3 f32)
  local.get $0
  local.get $1
  f32.add
  local.tee $0
  local.get $0
  f32.add
  call $~lib/math/NativeMathf.sin
  f32.const 0.20000000298023224
  f32.mul
  local.get $2
  f32.mul
  global.set $assembly/index/spiralRotY
  local.get $0
  f32.const 3
  f32.mul
  call $~lib/math/NativeMathf.sin
  f32.const 0.10000000149011612
  f32.mul
  local.get $3
  f32.const 1
  f32.add
  f32.mul
  global.set $assembly/index/spiralYOffset
  local.get $0
  f32.const 4
  f32.mul
  call $~lib/math/NativeMathf.sin
  f32.const 0.05000000074505806
  f32.mul
  local.get $2
  f32.mul
  f32.const 1
  f32.add
  global.set $assembly/index/spiralScale
 )
 (func $assembly/index/getSpiralRotY (result f32)
  global.get $assembly/index/spiralRotY
 )
 (func $assembly/index/getSpiralYOffset (result f32)
  global.get $assembly/index/spiralYOffset
 )
 (func $assembly/index/getSpiralScale (result f32)
  global.get $assembly/index/spiralScale
 )
 (func $assembly/index/calcPrismRose (param $0 f32) (param $1 f32) (param $2 f32) (param $3 f32) (param $4 i32)
  local.get $0
  local.get $1
  f32.add
  local.tee $0
  local.get $0
  f32.add
  call $~lib/math/NativeMathf.sin
  f32.const 0.10000000149011612
  f32.mul
  local.get $4
  if (result f32)
   local.get $3
   f32.const 3
   f32.mul
   f32.const 1
   f32.add
  else
   f32.const 0.30000001192092896
  end
  f32.mul
  global.set $assembly/index/prismUnfurl
  local.get $0
  f32.const 0.5
  f32.mul
  local.get $3
  local.get $3
  f32.add
  f32.add
  global.set $assembly/index/prismSpin
  local.get $2
  f32.const 0.30000001192092896
  f32.mul
  f32.const 1
  f32.add
  global.set $assembly/index/prismPulse
  local.get $0
  f32.const 0.10000000149011612
  f32.mul
  f32.const 1
  call $~lib/math/NativeMathf.mod
  global.set $assembly/index/prismHue
 )
 (func $assembly/index/getPrismUnfurl (result f32)
  global.get $assembly/index/prismUnfurl
 )
 (func $assembly/index/getPrismSpin (result f32)
  global.get $assembly/index/prismSpin
 )
 (func $assembly/index/getPrismPulse (result f32)
  global.get $assembly/index/prismPulse
 )
 (func $assembly/index/getPrismHue (result f32)
  global.get $assembly/index/prismHue
 )
 (func $assembly/index/lerpColor (param $0 i32) (param $1 i32) (param $2 f32) (result i32)
  (local $3 f32)
  local.get $0
  i32.const 255
  i32.and
  f32.convert_i32_u
  local.tee $3
  local.get $1
  i32.const 255
  i32.and
  f32.convert_i32_u
  local.get $3
  f32.sub
  local.get $2
  f32.mul
  f32.add
  i32.trunc_sat_f32_u
  local.get $0
  i32.const 16
  i32.shr_u
  i32.const 255
  i32.and
  f32.convert_i32_u
  local.tee $3
  local.get $1
  i32.const 16
  i32.shr_u
  i32.const 255
  i32.and
  f32.convert_i32_u
  local.get $3
  f32.sub
  local.get $2
  f32.mul
  f32.add
  i32.trunc_sat_f32_u
  i32.const 16
  i32.shl
  local.get $0
  i32.const 8
  i32.shr_u
  i32.const 255
  i32.and
  f32.convert_i32_u
  local.tee $3
  local.get $1
  i32.const 8
  i32.shr_u
  i32.const 255
  i32.and
  f32.convert_i32_u
  local.get $3
  f32.sub
  local.get $2
  f32.mul
  f32.add
  i32.trunc_sat_f32_u
  i32.const 8
  i32.shl
  i32.or
  i32.or
 )
 (func $assembly/index/calcRainDropY (param $0 f32) (param $1 f32) (param $2 f32) (param $3 f32) (result f32)
  local.get $0
  local.get $1
  local.get $2
  f32.mul
  local.get $3
  call $~lib/math/NativeMathf.mod
  f32.sub
 )
 (func $assembly/index/calcFloatingParticle (param $0 f32) (param $1 f32) (param $2 f32) (param $3 f32) (param $4 f32) (param $5 f32)
  local.get $0
  local.get $3
  local.get $4
  f32.add
  local.tee $0
  f32.const 0.5
  f32.mul
  call $~lib/math/NativeMathf.sin
  local.get $5
  f32.mul
  f32.add
  global.set $assembly/index/particleX
  local.get $1
  local.get $0
  f32.const 0.699999988079071
  f32.mul
  call $~lib/math/NativeMathf.sin
  local.get $5
  f32.mul
  f32.const 0.5
  f32.mul
  f32.add
  global.set $assembly/index/particleY
  local.get $2
  local.get $0
  f32.const 0.6000000238418579
  f32.mul
  call $~lib/math/NativeMathf.cos
  local.get $5
  f32.mul
  f32.add
  global.set $assembly/index/particleZ
 )
 (func $assembly/index/getParticleX (result f32)
  global.get $assembly/index/particleX
 )
 (func $assembly/index/getParticleY (result f32)
  global.get $assembly/index/particleY
 )
 (func $assembly/index/getParticleZ (result f32)
  global.get $assembly/index/particleZ
 )
)
