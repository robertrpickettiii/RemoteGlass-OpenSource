import {test} from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = globalThis;
const {default: Decoder} = await import('../decoders/mvs.js');
const {default: Bitstream} = await import('../decoders/mvs-bitstream.js');
const {createMvsRenderer} = await import('../decoders/mvs-wasm.js');
let seed = 91472;
function random() { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed; }
test('accelerated tile rendering exactly matches reference across coefficients and changing quantization', () => {
    const fast = new Decoder(), reference = new Decoder();
    assert.ok(fast._renderTile, 'acceleration must actually run in this test');
    reference._renderTile = null;
    for (let tile = 0; tile < 3000; tile++) {
        if (tile % 100 === 0) {
            for (let i = 0; i < 64; i++) {
                fast._lumaQuant[i] = 1 + random() % 255;
                fast._chromaQuant[i] = 1 + random() % 255;
            }
            fast._quantGen++;
            reference._lumaQuant.set(fast._lumaQuant);
            reference._chromaQuant.set(fast._chromaQuant);
        }
        fast._coeffs.fill(0);
        for (let i = 0; i < 192; i++) {
            // Include sparse/DC-only blocks and the full signed input range.
            if (i % 64 === 0 || tile % 3 !== 0 && random() % 4 === 0) {
                fast._coeffs[i] = tile % 2 ? (random() % 256) - 128 : (random() % 65536) - 32768;
            }
        }
        reference._coeffs.set(fast._coeffs);
        fast._dequantAndRender(); reference._dequantAndRender();
        assert.deepEqual(fast._tileBuf, reference._tileBuf, `tile ${tile}`);
    }
});
test('accelerated renderer instances do not share their coefficient state', () => {
    const a = createMvsRenderer(), b = createMvsRenderer();
    assert.ok(a && b);
    const qa = new Uint8Array(64).fill(1), ca = new Int16Array(192), cb = new Int16Array(192);
    cb[0] = 64;
    const oa = new Uint8Array(256), ob = new Uint8Array(256);
    a(ca,qa,qa,oa,1); b(cb,qa,qa,ob,1);
    assert.notDeepEqual(oa,ob);
    a(ca,qa,qa,oa,1); assert.equal(oa[0],128);
});
test('bit reservoir preserves mixed-width fields at every bit alignment and rejects truncation', () => {
    const bytes = Uint8Array.from({length:4096}, () => random() & 255);
    const bitString = Array.from(bytes.subarray(3,4090), b => b.toString(2).padStart(8,'0')).join('');
    const bs = new Bitstream(bytes,3,4087);
    let position = 0;
    while (position < bitString.length) {
        const n = Math.min(1 + random() % 32, bitString.length-position);
        const expected = parseInt(bitString.slice(position,position+n),2) | 0;
        assert.equal(bs.readBits(n),expected);
        position += n;
    }
    assert.equal(bs.remainingBits(),0);
    assert.throws(() => bs.readBit(), /past end/);
    assert.throws(() => bs.readBits(8), /past end/);
});
test('reference decoder stays usable when compiled execution is unavailable', () => {
    const saved = globalThis.WebAssembly;
    try {
        globalThis.WebAssembly = undefined;
        const fallback = new Decoder();
        assert.equal(fallback._renderTile,null);
        fallback._coeffs.fill(0); fallback._dequantAndRender();
        assert.deepEqual(Array.from(fallback._tileBuf.slice(0,4)),[128,128,128,255]);
    } finally { globalThis.WebAssembly = saved; }
});
test('compiled coefficient decoding matches the reference across full/repeat tiles and arbitrary bit offsets', () => {
    const fast = new Decoder(), reference = new Decoder();
    assert.ok(fast._entropy);
    reference._entropy = null;
    fast._ensureScreenState({width:16,height:8}); reference._ensureScreenState({width:16,height:8});
    let accepted = 0;
    for (let iteration = 0; iteration < 6000; iteration++) {
        const data = Uint8Array.from({length:256}, () => random() >>> 24);
        const a = new Bitstream(data,0,data.length), b = new Bitstream(data,0,data.length);
        const position = iteration % 8; data[0] &= ~(0x80 >> position); a.seek(position); b.seek(position);
        const t1 = random() % 32, t2 = random() % 32;
        for (let i = 0; i < 192; i++) fast._dpcmState[i] = (random() % 256) - 128;
        reference._dpcmState.set(fast._dpcmState);
        let errorA, errorB;
        try { fast._decodeDCT(a,t1,t2,0,-1); } catch(e) { errorA=e; }
        try { reference._decodeDCT(b,t1,t2,0,-1); } catch(e) { errorB=e; }
        assert.equal(!!errorA,!!errorB, `error parity ${iteration}`);
        if (errorA) continue;
        accepted++;
        assert.equal(a.position,b.position, `bit position ${iteration}`);
        assert.deepEqual(fast._coeffs,reference._coeffs, `coefficients ${iteration}`);
        assert.deepEqual(fast._tileBuf,reference._tileBuf, `pixels ${iteration}`);
        assert.deepEqual(fast._tileDescYCoeffs,reference._tileDescYCoeffs);
        // The next DCT tile can repeat this one, including its descriptor.
        const repeat = new Uint8Array([128]);
        fast._decodeDCT(new Bitstream(repeat,0,1),t1,t2,1,0);
        reference._decodeDCT(new Bitstream(repeat,0,1),t1,t2,1,0);
        assert.deepEqual(fast._tileBuf,reference._tileBuf);
    }
    assert.ok(accepted > 5000);
});
test('compiled partial coefficients, cache entries and pixels match the reference for signed baselines and both threshold ranges', () => {
    const fast = new Decoder(), reference = new Decoder();
    reference._entropy = null;
    fast._ensureScreenState({width:8,height:8}); reference._ensureScreenState({width:8,height:8});
    let accepted = 0;
    for (let iteration = 0; iteration < 6000; iteration++) {
        const data = Uint8Array.from({length:256}, () => random() >>> 24);
        const a = new Bitstream(data,0,data.length), b = new Bitstream(data,0,data.length);
        a.seek(iteration%8); b.seek(iteration%8);
        const threshold = random()%32, cr = random()%64, cb = random()%64;
        for (let i = 0; i < 64; i++) fast._tileDescYCoeffs[i] = (random()%256)-128;
        reference._tileDescYCoeffs.set(fast._tileDescYCoeffs);
        for (const d of [fast,reference]) {
            d._tileDescThreshold[0] = threshold;
            d._tileDescCbValid[0] = d._tileDescCrValid[0] = 1;
            d._tileDescCbDC[0] = (iteration%256)-128; d._tileDescCrDC[0] = 127-(iteration%256);
        }
        let errorA,errorB;
        try { fast._decodePartialDCT(a,0,cr,cb); } catch(e) { errorA=e; }
        try { reference._decodePartialDCT(b,0,cr,cb); } catch(e) { errorB=e; }
        assert.equal(!!errorA,!!errorB, `error parity ${iteration}`);
        if (errorA) continue;
        accepted++;
        assert.equal(a.position,b.position, `bit position ${iteration}`);
        assert.deepEqual(fast._coeffs,reference._coeffs, `coefficients ${iteration}`);
        assert.deepEqual(fast._cacheEntry,reference._cacheEntry, `cache ${iteration}`);
        assert.deepEqual(fast._tileBuf,reference._tileBuf, `pixels ${iteration}`);
    }
    assert.ok(accepted > 500);
});
test('coefficient acceleration preserves truncation errors and falls back for oversized packets', () => {
    const fast=new Decoder(),reference=new Decoder(); reference._entropy=null;
    fast._ensureScreenState({width:8,height:8});reference._ensureScreenState({width:8,height:8});
    for(let length=0;length<32;length++) {
        const data=Uint8Array.from({length},()=>random()>>>24);
        if(length) data[0]&=127;
        const a=new Bitstream(data,0,length),b=new Bitstream(data,0,length);
        fast._dpcmState.fill(0);reference._dpcmState.fill(0);
        let failedA=false,failedB=false;
        try{fast._decodeDCT(a,15,25,0,-1);}catch(_){failedA=true;}
        try{reference._decodeDCT(b,15,25,0,-1);}catch(_){failedB=true;}
        assert.equal(failedA,failedB,`truncated length ${length}`);
        if(!failedA) {assert.equal(a.position,b.position);assert.deepEqual(fast._tileBuf,reference._tileBuf);}
    }
    const large=new Uint8Array(8*1024*1024+1);
    const a=new Bitstream(large,0,large.length),b=new Bitstream(large,0,large.length);
    fast._dpcmState.fill(0);reference._dpcmState.fill(0);
    fast._decodeDCT(a,15,25,0,-1);reference._decodeDCT(b,15,25,0,-1);
    assert.equal(a.position,b.position);assert.deepEqual(fast._tileBuf,reference._tileBuf);
});
