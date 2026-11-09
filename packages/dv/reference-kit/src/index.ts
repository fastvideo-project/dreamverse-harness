/**
 * The reference kit: `defineReference` turns one declaration of a reference noun into its Cordis service. The service
 * registers with `dvProject` the noun's component key, its reducer, the reference kind of the same name, the two
 * operations `<k>.create` and `<k>.update`, and, while the DSH skill registry is mounted, the noun's skill. Each create
 * or update writes the next version of an ID; a shot names a version as the input `<id>@<version>`, which stands for
 * that version's reference images. The kit names no noun and no media type: the declaration gives both.
 *
 * @module @dv/reference-kit
 */
import { readFileSync } from 'node:fs'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import type {} from '@dv/canvas'
import type {
  AssetId, ComponentStates, OperationContext, OperationResult, OperationSpec, ProjectRecord, ProjectState, Reducer, RecordId,
  ReferenceKindSpec,
} from '@dv/project'
import type { ReferenceKey, ReferenceVersion } from './types.ts'

export * from './types.ts'

/** The declaration of one reference noun. */
export interface ReferenceSpec<K extends ReferenceKey> {
  /** Cordis service name, such as 'dvCharacter'; a literal, so a search finds it. */
  service: string
  /** Component key = reference kind = ID param = operation prefix, such as 'character'. */
  component: K
  /** The noun in labels and texts: 新建<zh> / Create <en>, such as { zh: '角色', en: 'character' }. */
  noun: { zh: string; en: string }
  /** What one item is, in the create description, such as 'a person who must look the same across shots'. */
  meaning: string
  /** The input roles of both operations; the kit names no media type. */
  reference: OperationSpec['inputs']
  /** The noun's skill; the skill name is `component`. */
  skill: { description: string; whenToUse: string; file: URL }
  /** Extra version fields: one param on both operations; an update that omits it keeps the previous value. */
  fields?: Record<string, { param: OperationSpec['params'][string]; initial: JsonValue }>
}

/** One version as the kit reads and writes it: the shared fields and the `fields` values of the declaration. */
type Version = ReferenceVersion & { [field: string]: JsonValue }

/** The versions of one noun by ID, as the kit reads a slice. */
type Versions = Record<string, Version[]>

/** @returns the versions by ID of the noun's slice, which is undefined for a key that a test merges as optional. */
function versionsOf(slice: object | undefined): Versions {
  return (slice ?? {}) as Versions
}

/** @returns a params field as text, or `fallback` for an absent or non-string field. */
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * The version a finished `<k>.create` or `<k>.update` record writes: the next version number; the name, description,
 * reference images and `fields` values the record does not set come from the previous version, else their initial value.
 * @param spec - the noun.
 * @param versions - the ID's versions before the record.
 * @param id - the ID.
 * @param record - the record.
 * @returns the version.
 */
function nextVersion<K extends ReferenceKey>(
  spec: ReferenceSpec<K>, versions: readonly Version[], id: string, record: ProjectRecord,
): Version {
  const previous = versions.at(-1)
  const references = record.inputs.flatMap(input => input.resolved_asset === null ? [] : [input.resolved_asset])
  const extra: Record<string, JsonValue> = {}
  for (const [field, { initial }] of Object.entries(spec.fields ?? {})) {
    // The runner validated the value against the field's param schema, so it is JSON.
    extra[field] = record.params[field] === undefined ? previous?.[field] ?? initial : record.params[field] as JsonValue
  }
  return {
    ...extra,
    id,
    version: versions.length + 1,
    name: text(record.params['name'], previous?.name ?? id),
    description: text(record.params['description'], previous?.description ?? ''),
    references: references.length > 0 || previous === undefined ? references : previous.references,
    created_by: record.id,
  }
}

/**
 * The reducer that `defineReference` registers; exported for tests.
 * @param spec - the noun.
 * @returns the reducer of the noun's slice, which reads the finished `<k>.create` and `<k>.update` records.
 */
export function referenceReducer<K extends ReferenceKey>(spec: ReferenceSpec<K>): Reducer<K> {
  const key: string = spec.component
  const operations = [`${key}.create`, `${key}.update`]
  const fieldNames = Object.keys(spec.fields ?? {})
  return {
    initial: () => ({}) as ComponentStates[K],
    reduce(slice, record) {
      if (!operations.includes(record.operation ?? '') || record.status !== 'done') return slice
      const id = String(record.params[key])
      const versions = versionsOf(slice)[id] ?? []
      return { ...versionsOf(slice), [id]: [...versions, nextVersion(spec, versions, id, record)] } as ComponentStates[K]
    },
    agentSummary(slice) {
      const latest = Object.values(versionsOf(slice)).flatMap(list => list.slice(-1)).map(version => ({
        id: version.id, version: version.version, name: version.name, description: version.description, references: version.references,
        ...Object.fromEntries(fieldNames.map(field => [field, version[field] ?? null])),
      }))
      return { [`${key}s`]: latest }
    },
  }
}

/** @returns the reference kind of the noun, which answers for a version from the noun's slice. */
function referenceKind<K extends ReferenceKey>(spec: ReferenceSpec<K>): ReferenceKindSpec<K> {
  const versionOf = (slice: ComponentStates[K], id: string, version: number): Version | undefined =>
    versionsOf(slice)[id]?.find(candidate => candidate.version === version)
  return {
    kind: spec.component,
    component: spec.component,
    assetsOf: (slice, id, version): AssetId[] | null => versionOf(slice, id, version)?.references ?? null,
    createdBy: (slice, id, version): RecordId | null => versionOf(slice, id, version)?.created_by ?? null,
    latest: (slice, id) => versionsOf(slice)[id]?.at(-1)?.version ?? null,
  }
}

/** @returns the params of both operations: the ID (described by `id`), the name, the description and each `fields` param. */
function params<K extends ReferenceKey>(spec: ReferenceSpec<K>, id: string, required: boolean): OperationSpec['params'] {
  const fields = Object.fromEntries(Object.entries(spec.fields ?? {}).map(([field, { param }]) => [field, param]))
  return {
    [spec.component]: { type: 'string', required: true, description: id },
    name: required ? { type: 'string', required: true, description: 'Display name.' } : { type: 'string', description: 'Display name.' },
    description: { type: 'string', description: 'Words carried into every prompt: wardrobe, mood, or look.' },
    ...fields,
  }
}

/**
 * `<k>.create`: version 1 of an ID that no reference kind has.
 * @param spec - the noun.
 * @param project - the service whose `kindsWithId` lists the reference kinds that have an ID.
 * @returns the operation.
 */
function createOperation<K extends ReferenceKey>(spec: ReferenceSpec<K>, project: Pick<Context['dvProject'], 'kindsWithId'>): OperationSpec {
  const key: string = spec.component
  return {
    name: `${key}.create`,
    component: key,
    version: '1',
    label: { zh: `新建${spec.noun.zh}`, en: `Create ${spec.noun.en}` },
    description: `Create a ${key} (${spec.meaning}) with its reference images. Writes version 1; a shot names it as the input `
      + `<${key}>@1, which stands for those reference images. The ID must not name any other item that an input names as <id>@<version>.`,
    inputs: spec.reference,
    params: params(spec, `Short stable ID, such as ${key.slice(0, 1)}1; without @ or #.`, true),
    outputs: [],
    deterministic: false,
    resource: 'none',
    summarize: record => `${key} ${text(record.params['name'], text(record.params[key]))} created`,
    execute(context: OperationContext): Promise<OperationResult> {
      const id = text(context.params[key])
      if (id === '' || /[@#]/.test(id)) throw new Error(`The ${key} ID '${id}' must be non-empty and contain no @ or #.`)
      const used = project.kindsWithId(context.state, id)
      if (used.length > 0) throw new Error(`The ID '${id}' already names a ${used.join(', ')}; update it, or choose another ID.`)
      return Promise.resolve({ outputs: [] })
    },
  }
}

/**
 * `<k>.update`: the next version of an ID. It supersedes the record that wrote the current version, so the records
 * that read that version become stale, and is based on that record, so it is a version of the item's canvas node.
 * @param spec - the noun.
 * @returns the operation.
 */
function updateOperation<K extends ReferenceKey>(spec: ReferenceSpec<K>): OperationSpec {
  const key: string = spec.component
  const latest = (state: ProjectState, id: string): Version | undefined => versionsOf(state.components[spec.component])[id]?.at(-1)
  return {
    name: `${key}.update`,
    component: key,
    version: '1',
    label: { zh: `修改${spec.noun.zh}`, en: `Update ${spec.noun.en}` },
    description: `Update a ${key}: new reference images, name, or description. Writes the next version, which keeps what the `
      + 'call does not change, and marks everything made with the previous version as stale.',
    inputs: spec.reference,
    params: params(spec, `The ${key} ID.`, false),
    outputs: [],
    deterministic: false,
    resource: 'none',
    supersedes: (values: Record<string, unknown>, state: ProjectState): RecordId[] => {
      const current = latest(state, text(values[key]))
      return current === undefined ? [] : [current.created_by]
    },
    // The next version joins the canvas node of the item.
    basedOn: (values: Record<string, unknown>, state: ProjectState): RecordId | null =>
      latest(state, text(values[key]))?.created_by ?? null,
    summarize: record => `${key} ${text(record.params[key])} updated`,
    execute(context: OperationContext): Promise<OperationResult> {
      const id = text(context.params[key])
      if (latest(context.state, id) === undefined) throw new Error(`Unknown ${key} '${id}'.`)
      return Promise.resolve({ outputs: [] })
    },
  }
}

/**
 * The service class of one noun: registers the component, reducer, kind, both operations and the skill.
 * @param spec - the noun.
 * @returns the class; the noun package default-exports a subclass of it.
 */
export function defineReference<K extends ReferenceKey>(spec: ReferenceSpec<K>): new (ctx: Context) => Service {
  const skill = {
    name: spec.component, description: spec.skill.description, whenToUse: spec.skill.whenToUse,
    content: readFileSync(spec.skill.file, 'utf8'), source: 'runtime' as const,
  }
  return class extends Service {
    static inject = ['dvProject']
    // A noun has no settings.
    static Config: z<Record<string, unknown>> = z.object({})

    constructor(ctx: Context) {
      super(ctx, spec.service)
      const project = ctx.dvProject
      ctx.effect(() => project.registerComponent(spec.component), `${spec.service} component`)
      ctx.effect(() => project.registerReducer(spec.component, referenceReducer(spec)), `${spec.service} reducer`)
      ctx.effect(() => project.registerReferenceKind(referenceKind(spec)), `${spec.service} kind`)
      for (const operation of [createOperation(spec, project), updateOperation(spec)]) {
        ctx.effect(() => project.registerOperation(operation), `${spec.service} ${operation.name}`)
      }
      ctx.inject(['skills'], (child) => {
        child.effect(() => child.skills.register(skill), `${spec.service} skill`)
      })
      const key: string = spec.component
      ctx.inject(['dvCanvasNodes'], (canvas) => {
        canvas.effect(() => canvas.dvCanvasNodes.registerMaker({ operations: [`${key}.create`], kind: key, column: 0 }),
          `${spec.service} canvas nodes`)
      })
    }
  }
}
