(module
 (type $0 (func (result f64)))
 (type $1 (func (param i32 i32 f32)))
 (type $2 (func (param f32 f32 f32 i32) (result i32)))
 (import "env" "seed" (func $~lib/builtins/seed (result f64)))
 (global $~lib/math/random_seeded (mut i32) (i32.const 0))
 (global $~lib/math/random_state0_64 (mut i64) (i64.const 0))
 (global $~lib/math/random_state1_64 (mut i64) (i64.const 0))
 (memory $0 0)
 (export "updateParticles" (func $assembly/index/updateParticles))
 (export "checkCollision" (func $assembly/index/checkCollision))
 (export "memory" (memory $0))
 (func $~lib/math/NativeMath.random (result f64)
  (local $0 i64)
  (local $1 i64)
  global.get $~lib/math/random_seeded
  i32.eqz
  if
   call $~lib/builtins/seed
   i64.reinterpret_f64
   local.tee $0
   i64.eqz
   if
    i64.const -7046029254386353131
    local.set $0
   end
   local.get $0
   local.get $0
   i64.const 33
   i64.shr_u
   i64.xor
   i64.const -49064778989728563
   i64.mul
   local.tee $0
   i64.const 33
   i64.shr_u
   local.get $0
   i64.xor
   i64.const -4265267296055464877
   i64.mul
   local.tee $0
   i64.const 33
   i64.shr_u
   local.get $0
   i64.xor
   global.set $~lib/math/random_state0_64
   global.get $~lib/math/random_state0_64
   i64.const -1
   i64.xor
   local.tee $0
   i64.const 33
   i64.shr_u
   local.get $0
   i64.xor
   i64.const -49064778989728563
   i64.mul
   local.tee $0
   i64.const 33
   i64.shr_u
   local.get $0
   i64.xor
   i64.const -4265267296055464877
   i64.mul
   local.tee $0
   i64.const 33
   i64.shr_u
   local.get $0
   i64.xor
   global.set $~lib/math/random_state1_64
   i32.const 1
   global.set $~lib/math/random_seeded
  end
  global.get $~lib/math/random_state0_64
  local.set $1
  global.get $~lib/math/random_state1_64
  local.tee $0
  global.set $~lib/math/random_state0_64
  local.get $0
  local.get $1
  local.get $1
  i64.const 23
  i64.shl
  i64.xor
  local.tee $1
  i64.const 17
  i64.shr_u
  local.get $1
  i64.xor
  i64.xor
  local.get $0
  i64.const 26
  i64.shr_u
  i64.xor
  global.set $~lib/math/random_state1_64
  local.get $0
  i64.const 12
  i64.shr_u
  i64.const 4607182418800017408
  i64.or
  f64.reinterpret_i64
  f64.const -1
  f64.add
 )
 (func $assembly/index/updateParticles (param $0 i32) (param $1 i32) (param $2 f32)
  (local $3 f32)
  (local $4 i32)
  (local $5 i32)
  (local $6 f32)
  (local $7 f32)
  (local $8 f32)
  (local $9 f32)
  (local $10 f32)
  (local $11 f32)
  loop $for-loop|0
   local.get $1
   local.get $5
   i32.gt_s
   if
    local.get $0
    local.get $5
    i32.const 5
    i32.shl
    i32.add
    local.tee $4
    f32.load offset=16
    local.set $6
    local.get $4
    f32.load
    local.get $6
    local.get $2
    f32.mul
    local.get $4
    f32.load offset=28
    local.tee $3
    f32.mul
    f32.add
    local.set $7
    local.get $4
    f32.load offset=4
    local.get $4
    f32.load offset=20
    local.get $2
    local.get $2
    f32.add
    f32.sub
    local.tee $8
    local.get $2
    f32.mul
    local.get $3
    f32.mul
    f32.add
    local.set $9
    local.get $4
    f32.load offset=8
    local.get $4
    f32.load offset=24
    local.tee $10
    local.get $2
    f32.mul
    local.get $3
    f32.mul
    f32.add
    local.set $11
    local.get $4
    f32.load offset=12
    local.get $2
    f32.const 0.20000000298023224
    f32.mul
    f32.sub
    local.tee $3
    f32.const 0
    f32.le
    if
     f32.const 10
     local.set $9
     f32.const 2
     local.set $8
     call $~lib/math/NativeMath.random
     f32.demote_f64
     f32.const -0.5
     f32.add
     f32.const 5
     f32.mul
     local.set $7
     call $~lib/math/NativeMath.random
     f32.demote_f64
     f32.const -0.5
     f32.add
     f32.const 5
     f32.mul
     local.set $11
     call $~lib/math/NativeMath.random
     f32.demote_f64
     f32.const -0.5
     f32.add
     f32.const 2
     f32.mul
     local.set $6
     call $~lib/math/NativeMath.random
     f32.demote_f64
     f32.const -0.5
     f32.add
     f32.const 2
     f32.mul
     local.set $10
     f32.const 1
     local.set $3
    end
    local.get $4
    local.get $7
    f32.store
    local.get $4
    local.get $9
    f32.store offset=4
    local.get $4
    local.get $11
    f32.store offset=8
    local.get $4
    local.get $3
    f32.store offset=12
    local.get $4
    local.get $6
    f32.store offset=16
    local.get $4
    local.get $8
    f32.store offset=20
    local.get $4
    local.get $10
    f32.store offset=24
    local.get $5
    i32.const 1
    i32.add
    local.set $5
    br $for-loop|0
   end
  end
 )
 (func $assembly/index/checkCollision (param $0 f32) (param $1 f32) (param $2 f32) (param $3 i32) (result i32)
  i32.const 0
 )
)
