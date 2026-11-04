/**
 * Entity registry (#1973 slice 3): spawn/despawn round trip, multi-kind
 * membership, read-only views that stay the same array across spawns,
 * despawn hooks firing once per kind, pinned kinds, classifiers and the
 * secondary key index.
 *
 * Run with: npx tsx tests/entity-registry.test.ts
 */

import * as THREE from 'three';
import { EntityRegistry } from '../src/core/entities/registry.ts';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
    if (cond) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

console.log('spawn / despawn round trip');
{
    const r = new EntityRegistry();
    r.registerKind('mushroom');
    const obj = new THREE.Object3D();
    const id = r.spawn('mushroom', obj);
    check('id is obj.uuid', id === obj.uuid);
    check('has(id) after spawn', r.has(id));
    check('byId returns the object', r.byId(id) === obj);
    check('query lists it', r.query('mushroom').length === 1 && r.query('mushroom')[0] === obj);
    check(
        're-spawn under the same kind is a no-op',
        r.spawn('mushroom', obj) === id && r.query('mushroom').length === 1
    );
    check('despawn returns true', r.despawn(id) === true);
    check(
        'gone after despawn',
        !r.has(id) && r.byId(id) === undefined && r.query('mushroom').length === 0
    );
    check('kindsOf an unknown id is empty', r.kindsOf(id).length === 0);
}

console.log('multi-kind membership');
{
    const r = new EntityRegistry();
    r.registerKind('animated');
    r.registerKind('obstacle');
    const obj = new THREE.Object3D();
    const id = r.spawn('animated', obj);
    r.spawn('obstacle', obj);
    check(
        'kindsOf lists both kinds in join order',
        r.kindsOf(id).join(',') === 'animated,obstacle'
    );
    check('despawn(id, kind) leaves one kind', r.despawn(id, 'obstacle') === true);
    check(
        'still live under the other kind',
        r.has(id) && r.query('animated').length === 1 && r.query('obstacle').length === 0
    );
    check(
        'despawn(id, kind) for a kind it is not in returns false',
        r.despawn(id, 'obstacle') === false
    );
    check(
        'leaving the last kind forgets the entity',
        r.despawn(id, 'animated') === true && !r.has(id)
    );

    const other = new THREE.Object3D();
    other.uuid = obj.uuid;
    r.spawn('animated', obj);
    let threw = false;
    try {
        r.spawn('animated', other);
    } catch {
        threw = true;
    }
    check('a different object with a taken id throws', threw);
}

console.log('views are referentially stable');
{
    const r = new EntityRegistry();
    const early = r.view('later');
    r.registerKind('later');
    const a = new THREE.Object3D();
    const b = new THREE.Object3D();
    const before = r.query('later');
    r.spawn('later', a);
    check('query returns the same array across a spawn', r.query('later') === before);
    check(
        'a view taken before registerKind is the live one',
        early === before && early.length === 1
    );
    r.spawn('later', b);
    r.despawn(a.uuid);
    check(
        'same array across a despawn, order preserved',
        r.query('later') === before && before.length === 1 && before[0] === b
    );
    check('query of a never-seen kind is empty', r.query('nothing').length === 0);
}

console.log('member payloads');
{
    const r = new EntityRegistry();
    r.registerKind('vineSwing');
    const vine = new THREE.Object3D();
    const manager = { vine };
    r.spawn('vineSwing', vine, manager);
    const view = r.view<typeof manager>('vineSwing');
    check('view holds the payload, not the object', view.length === 1 && view[0] === manager);
    r.despawn(vine.uuid);
    check('despawn removes the payload', view.length === 0);
}

console.log('despawn hooks');
{
    const r = new EntityRegistry<{ tag: string }>();
    const calls: string[] = [];
    let seenCtx: string | undefined;
    r.registerKind('a', { onDespawn: () => calls.push('a') });
    r.registerKind('b', {
        onDespawn: (_id, _obj, ctx) => {
            calls.push('b');
            seenCtx = ctx?.tag;
        },
    });
    r.registerKind('c', { onSpawn: () => calls.push('spawn:c') });
    const obj = new THREE.Object3D();
    r.spawn('a', obj);
    r.spawn('b', obj);
    r.spawn('c', obj);
    r.spawn('c', obj);
    check('onSpawn fires once per kind', calls.join(',') === 'spawn:c');
    calls.length = 0;
    r.despawn(obj.uuid, undefined, { tag: 'ctx' });
    check('every kind’s onDespawn fires exactly once', calls.join(',') === 'a,b', calls.join(','));
    check('despawn passes the caller context to hooks', seenCtx === 'ctx');
    calls.length = 0;
    check(
        'a second despawn returns false and fires nothing',
        r.despawn(obj.uuid) === false && calls.length === 0
    );
    check('despawn of an unknown id returns false', r.despawn('no-such-id') === false);
}

console.log('classifiers, adopt and pinned kinds');
{
    const r = new EntityRegistry();
    const torn: string[] = [];
    r.registerKind('evict:tree', { onDespawn: (id) => torn.push(id) });
    r.registerKind('evict:never', { pinned: true });
    r.registerClassifier((obj) => {
        const t = obj.userData.type as string | undefined;
        if (t === 'tree') return 'evict:tree';
        if (t === 'locked') return 'evict:never';
        return t === 'unregistered' ? 'evict:unregistered' : null;
    });
    const tree = new THREE.Object3D();
    tree.userData.type = 'tree';
    check('canDespawn before adopt follows the classifier', r.canDespawn(tree));
    const id = r.adopt(tree);
    check('adopt joins the classified kind', r.kindsOf(id).join(',') === 'evict:tree');
    r.adopt(tree);
    check('adopt is idempotent', r.query('evict:tree').length === 1);
    r.despawn(id);
    check('adopted kind hook fires on despawn', torn.length === 1 && torn[0] === id);

    const locked = new THREE.Object3D();
    locked.userData.type = 'locked';
    check('a pinned classification refuses canDespawn', !r.canDespawn(locked));
    const ghost = new THREE.Object3D();
    ghost.userData.type = 'unregistered';
    r.adopt(ghost);
    check('adopt ignores kinds nobody registered', !r.has(ghost.uuid));
}

console.log('secondary key index');
{
    const r = new EntityRegistry({
        keyOf: (obj) =>
            typeof obj.userData.mapEntityId === 'string' ? obj.userData.mapEntityId : undefined,
    });
    const a = new THREE.Object3D();
    const b = new THREE.Object3D();
    const c = new THREE.Object3D();
    a.userData.mapEntityId = 'm1';
    b.userData.mapEntityId = 'm1';
    r.spawn('k', a);
    r.spawn('k', b);
    r.spawn('k', c);
    check('byKey lists every entity with the key', r.byKey('m1').length === 2);
    check('byKey of an unknown key is empty', r.byKey('m2').length === 0);
    r.despawn(a.uuid);
    check(
        'despawn drops it from the key index',
        r.byKey('m1').length === 1 && r.byKey('m1')[0] === b
    );
    r.despawn(b.uuid);
    check('last one out clears the key', r.byKey('m1').length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
