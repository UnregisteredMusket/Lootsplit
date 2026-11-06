// The parts of @3d-dice/dice-box-threejs (MIT, no bundled types) that Lootsplitter uses.
declare module "@3d-dice/dice-box-threejs" {
  export type DiceBoxResult = {
    notation: string;
    sets: { type: string; sides: number; rolls: { type: string; value: number }[]; total: number }[];
    modifier: number;
    total: number;
  };
  export type DiceBoxColorset = {
    name: string;
    foreground: string;
    background: string;
    outline: string;
    texture: string;
    material: string;
  };
  export default class DiceBox {
    constructor(selector: string, options?: Record<string, unknown>);
    initialize(): Promise<void>;
    updateConfig(options: Record<string, unknown>): Promise<void>;
    roll(notation: string): Promise<DiceBoxResult>;
    clearDice(): void;
    getDiceResults(): DiceBoxResult;
    /** Internal: the thrown dice. */
    diceList: { shape: string; result: unknown[]; storeRolledValue(reason?: string): void }[];
  }
}
