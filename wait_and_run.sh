pnpm run dev &
pid=$!
npx wait-on http://localhost:5173 --timeout 60000
node test-webgpu.mjs
kill $pid
