import { SimulationApp } from './app/SimulationApp';

const container = document.getElementById('app');
if (!container) throw new Error('Could not find #app element');

let app = new SimulationApp(container);

// Vite HMR: 古いインスタンスのイベントリスナーをクリーンアップ
const hot = (import.meta as unknown as { hot?: { dispose(cb: () => void): void } }).hot;
if (hot) {
  hot.dispose(() => { app.dispose(); });
}
