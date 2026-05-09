import { SimulationApp } from './app/SimulationApp';

const container = document.getElementById('app');
if (!container) throw new Error('Could not find #app element');

new SimulationApp(container);
