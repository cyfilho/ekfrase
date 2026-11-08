// SPDX-License-Identifier: MPL-2.0

/**
 * Comandos: o único caminho para mudar o documento (porta aberta 4, DEC-011).
 * Interface, plugins, sincronização e, no futuro, eventos de RPG usam o mesmo `apply`.
 * Desfazer/refazer é por usuário, sobre os comandos aplicados localmente.
 */

import type { Cell } from '@ekfrase/maker-core';
import type { Annotation, Entity, Feature, GeneratorRef, JsonValue, PluginRef, PointKm } from './schema';

export type WorldPatch = {
  readonly seed?: string;
  readonly extentKm?: { readonly ns: number; readonly ew: number };
  readonly s0M?: number;
  readonly generator?: GeneratorRef;
  readonly style?: string;
};

export type Command =
  | { readonly type: 'meta.rename'; readonly name: string }
  | { readonly type: 'world.update'; readonly patch: WorldPatch }
  | { readonly type: 'edit.set'; readonly cell: Cell; readonly prop: string; readonly value: JsonValue }
  | { readonly type: 'edit.clear'; readonly cell: Cell; readonly prop: string }
  | { readonly type: 'entity.add'; readonly id?: string; readonly entity: Entity }
  | { readonly type: 'entity.move'; readonly id: string; readonly posKm: PointKm }
  | { readonly type: 'entity.setComponent'; readonly id: string; readonly name: string; readonly value: JsonValue }
  | { readonly type: 'entity.removeComponent'; readonly id: string; readonly name: string }
  | { readonly type: 'entity.remove'; readonly id: string }
  | { readonly type: 'feature.add'; readonly id?: string; readonly feature: Feature }
  | { readonly type: 'feature.setPoints'; readonly id: string; readonly pointsKm: readonly PointKm[] }
  | { readonly type: 'feature.setProp'; readonly id: string; readonly name: string; readonly value: JsonValue }
  | { readonly type: 'feature.remove'; readonly id: string }
  | { readonly type: 'annotation.add'; readonly id?: string; readonly annotation: Annotation }
  | { readonly type: 'annotation.remove'; readonly id: string }
  | { readonly type: 'plugin.require'; readonly id: string; readonly plugin: PluginRef }
  | { readonly type: 'plugin.drop'; readonly id: string };

export type CommandType = Command['type'];

/** Resultado de `apply`: o id criado, nos comandos `*.add`. */
export interface ApplyResult {
  readonly id?: string;
}
