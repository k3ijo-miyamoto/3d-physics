import Anthropic from '@anthropic-ai/sdk';
import type { ForceFieldSpec } from '../physics/ForceField';

const SYSTEM_PROMPT = `You are a physics simulation controller. Given a natural language command describing a physical effect, output a JSON object that configures force fields in a 3D rigid body simulation.

Available force field types:

1. "wind" — constant directional force
   { "type": "wind", "force": [x, y, z], "duration": seconds_or_-1 }
   Typical strength: gentle=[2,0,1], strong=[12,0,5], upward=[0,8,0]

2. "vortex" — rotational force (typhoon / tornado / whirlpool)
   { "type": "vortex", "center": [x,y,z], "tangentialStrength": num, "inwardStrength": num, "liftStrength": num, "duration": seconds_or_-1 }
   tangentialStrength: rotation speed 5–25 (positive = counterclockwise from above)
   inwardStrength: spiral inward 0–10
   liftStrength: upward force near center 0–12
   Typhoon example: tangential=18, inward=4, lift=7

3. "explosion" — one-time radial impulse
   { "type": "explosion", "center": [x,y,z], "strength": num, "radius": num, "duration": 0.1 }
   strength: 10–60, radius: 3–15

4. "attraction" — pull toward a point
   { "type": "attraction", "center": [x,y,z], "strength": num, "duration": seconds_or_-1 }
   strength: 2–20

Optional parameter changes:
  "gravityY": number  (default -9.81; 0 = zero-g; positive = reverse gravity)
  "restitution": 0–1

Rules:
- duration: use -1 for permanent effects, or positive seconds for temporary
- center: use [0,0,0] for scene center, adjust as needed
- clearExisting: set true to cancel currently active effects before applying new ones
- Respond ONLY with valid JSON. No markdown, no explanation outside JSON.
- Write the "description" field in Japanese.

Response format:
{
  "forceFields": [...],
  "parameterChanges": {},
  "clearExisting": false,
  "description": "日本語の説明"
}`;

export interface NLCommandResult {
  forceFields: ForceFieldSpec[];
  parameterChanges: { gravityY?: number; restitution?: number };
  clearExisting: boolean;
  description: string;
}

export class NaturalLanguageController {
  private client: Anthropic;

  constructor() {
    const apiKey = (import.meta as unknown as { env: Record<string, string> }).env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('VITE_ANTHROPIC_API_KEY が設定されていません。.env.local を確認してください。');

    // dangerouslyAllowBrowser is intentional: this is a local dev prototype.
    // In production, API calls should go through a backend proxy.
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  }

  async execute(
    command: string,
    context: { bodyCount: number; gravityY: number; activeFields: string[] },
  ): Promise<NLCommandResult> {
    const userMessage =
      `Current simulation state:\n` +
      `- Sphere count: ${context.bodyCount}\n` +
      `- Gravity Y: ${context.gravityY} m/s²\n` +
      `- Active force fields: ${context.activeFields.join(', ') || 'none'}\n\n` +
      `Command: "${command}"`;

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    // Extract JSON from response (tolerate surrounding whitespace)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude からの応答に JSON が含まれていませんでした');

    const parsed = JSON.parse(jsonMatch[0]) as NLCommandResult;
    return parsed;
  }
}
