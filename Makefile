CXX = emcc
CXXFLAGS = -O3 -flto -msimd128 -s WASM=1 -s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=1 --no-entry
EXPORTED_FUNCTIONS = '_updateParticles', '_checkCollision', '_initParticles', '_seedRandom', '_malloc', '_free'

SRC = src/physics.cpp
OUT = build/optimized_cpp.wasm
DIST_OUT = dist/build/optimized_cpp.wasm

all: $(OUT)

$(OUT): $(SRC)
	mkdir -p build
	$(CXX) $(CXXFLAGS) -s "EXPORTED_FUNCTIONS=[$(EXPORTED_FUNCTIONS)]" -o $@ $<

dist: $(OUT)
	mkdir -p dist/build
	cp $(OUT) $(DIST_OUT)

clean:
	rm -f $(OUT) $(DIST_OUT)
