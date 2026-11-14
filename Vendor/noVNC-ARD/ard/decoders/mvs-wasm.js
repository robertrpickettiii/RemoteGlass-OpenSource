/* MPL-2.0. Optional, bundled WebAssembly acceleration. No network access. */
import { mvsWasmBase64 } from './mvs-wasm-data.js';
let module;
let attempted = false;
export function createMvsRenderer() {
    if (!attempted) {
        attempted = true;
        try {
            const binary = atob(mvsWasmBase64);
            const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
            module = new WebAssembly.Module(bytes);
        } catch (_) { /* The reference JS decoder remains available. */ }
    }
    if (!module) return null;
    try {
        const instance = new WebAssembly.Instance(module);
        const {memory, buffers, render} = instance.exports;
        const addresses = new Uint32Array(memory.buffer, buffers(), 3);
        const coefficients = new Int16Array(memory.buffer, addresses[0], 192);
        const quantization = new Uint8Array(memory.buffer, addresses[1], 128);
        const pixels = new Uint8Array(memory.buffer, addresses[2], 256);
        let generation = null;
        const renderTile = (coeffs, luma, chroma, output, quantGeneration) => {
            if (coeffs !== coefficients) coefficients.set(coeffs);
            if (generation !== quantGeneration) {
                quantization.set(luma); quantization.set(chroma, 64);
                generation = quantGeneration;
            }
            render();
            if (output !== pixels) output.set(pixels);
        };
        const entropyAddresses = new Uint32Array(memory.buffer, instance.exports.entropy_buffers(), 4);
        const input = new Uint8Array(memory.buffer, entropyAddresses[0], 8 * 1024 * 1024);
        const state = new Int16Array(memory.buffer, entropyAddresses[1], 192);
        const descriptor = new Int8Array(memory.buffer, entropyAddresses[2], 64);
        const entry = new Int8Array(memory.buffer, entropyAddresses[3], 99);
        let activeStream = null;
        function prepare(bs) {
            if (bs._length > input.length) return false;
            if (activeStream !== bs) {
                input.set(bs._data.subarray(bs._offset, bs._offset + bs._length));
                activeStream = bs;
            }
            return true;
        }
        function finish(bs) {
            const position = instance.exports.entropy_position();
            if (position < 0) throw new Error('MvsBitstream: read past end or invalid Huffman code');
            bs.seek(position);
        }
        renderTile.entropy = {
            full(bs, predictor, t1, t2, previous) {
                if (!prepare(bs)) return undefined;
                state.set(predictor);
                const threshold = instance.exports.entropy_full(bs.position, bs._length, t1, t2, previous ? 1 : 0);
                finish(bs);
                return threshold;
            },
            partial(bs, baseline, threshold, cr, cb, crLimit, cbLimit, outputEntry) {
                if (!prepare(bs)) return false;
                descriptor.set(baseline);
                instance.exports.entropy_partial(bs.position, bs._length, threshold, cr, cb, crLimit, cbLimit);
                finish(bs);
                outputEntry.set(entry);
                return true;
            },
        };
        renderTile.coefficients = coefficients;
        renderTile.pixels = pixels;
        return renderTile;
    } catch (_) { return null; }
}
