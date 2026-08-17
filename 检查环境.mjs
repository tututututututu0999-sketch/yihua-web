import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const minimumNodeMajor = 22;
const nodeMajor = Number(process.versions.node.split('.')[0]);
const root = new URL('.', import.meta.url);
const envPath = new URL('.env', root);

const fail = message => {
  console.error(`\n检查未通过：${message}`);
  process.exitCode = 1;
};

console.log('易画本地测试环境检查');
console.log(`Node.js：${process.version}`);

if (!Number.isFinite(nodeMajor) || nodeMajor < minimumNodeMajor) {
  fail(`需要 Node.js ${minimumNodeMajor}+。当前版本为 ${process.version}。`);
} else {
  console.log(`Node.js 版本符合要求（${minimumNodeMajor}+）。`);
}

if (!existsSync(envPath)) {
  fail('未找到 .env。请将 .env.example 复制为 .env，并填写自己的 CCPROXY_API_KEY。');
} else {
  const env = readFileSync(envPath, 'utf8');
  const apiKey = env.match(/^\s*CCPROXY_API_KEY\s*=\s*(.*?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '') || '';
  if (!apiKey || /请在这里填写|your[_ -]?api|example/i.test(apiKey)) {
    fail('CCPROXY_API_KEY 尚未填写有效值。');
  } else {
    console.log('已检测到 CCPROXY_API_KEY。');
  }
}

try {
  const listening = execFileSync('lsof', ['-nP', '-iTCP:4175', '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (listening) console.log('提示：4175 端口已有服务在运行，可直接打开 http://127.0.0.1:4175/。');
} catch {
  console.log('4175 端口可用于启动测试服务。');
}

if (!process.exitCode) {
  console.log('\n检查通过。可运行：PORT=4175 node server.mjs');
}
