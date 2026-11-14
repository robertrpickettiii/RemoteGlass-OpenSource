/* MPL-2.0. Batched form of mvs.js _dequantAndRender. Integer IDCT and zigzag
 * are supplied from the checked-in JS reference by build-mvs-wasm.py.
 * Fixed buffers bound memory use and avoid allocation per tile. */
static short coefficients[192];
static unsigned char quantization[128];
static unsigned char pixels[256];
static unsigned char spatial[192];
static int dequantized[64];
static unsigned int addresses[3];

unsigned int buffers(void) {
    addresses[0] = (unsigned int)coefficients;
    addresses[1] = (unsigned int)quantization;
    addresses[2] = (unsigned int)pixels;
    return (unsigned int)addresses;
}
static unsigned char clamp(int x) { return x < 0 ? 0 : x > 255 ? 255 : x; }
void render(void) {
    for (int plane = 0; plane < 3; plane++) {
        int base = plane * 64;
        unsigned char *q = quantization + (plane == 0 ? 0 : 64);
        unsigned char *out = spatial + base;
        int ac = 0;
        dequantized[0] = coefficients[base] * q[0];
        for (int i = 1; i < 64; i++) {
            int value = coefficients[base + i];
            ac |= value;
            dequantized[zigzag[i]] = value * q[zigzag[i]];
        }
        if (ac == 0) {
            unsigned char dc = idctFlat(dequantized[0]);
            for (int i = 0; i < 64; i++) out[i] = dc;
        } else { idct8x8(dequantized, out); }
    }
    for (int i = 0; i < 64; i++) {
        int y = spatial[i], cb = spatial[64 + i] - 128, cr = spatial[128 + i] - 128;
        pixels[i*4] = clamp(y + ((91881 * cr + 32768) >> 16));
        pixels[i*4+1] = clamp(y + ((-22554 * cb + 32768 - 46802 * cr) >> 16));
        pixels[i*4+2] = clamp(y + ((116130 * cb + 32768) >> 16));
        pixels[i*4+3] = 255;
    }
}
