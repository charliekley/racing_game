/**
 * The 3D podium on the TV (see the contract in postRace.ts).
 *
 * PLACEHOLDER: this stub only exists so the flow side compiles and runs before the real podium is built.
 * It shows nothing and resolves the reveal right away. The visual agent replaces this file.
 */
import type { PodiumApi, PodiumEntry } from './postRace';

export function createPodium(_parent: HTMLElement): PodiumApi {
  return {
    show(_entries: readonly PodiumEntry[], _title: string): Promise<void> {
      return Promise.resolve();
    },
    hide(): void {},
    update(_dt: number): void {},
  };
}
