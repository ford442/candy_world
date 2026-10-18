git clone https://github.com/emscripten-core/emsdk.git
EMSDK_VERSION="$(cat .emsdk-version 2>/dev/null || echo 4.0.10)"
cd emsdk && ./emsdk install "$EMSDK_VERSION" && ./emsdk activate "$EMSDK_VERSION" && source ./emsdk_env.sh
npm install
