/** Loader validation of config objects whose stale or misspelled keys must fail at load. */
import z from '@deepseek-ai/schemastery'

/**
 * An object schema that also refuses keys it does not declare, so that a stale field such as `frameSizes` fails at
 * load instead of passing through unread.
 * @param name - the config path in the error message, such as `modelFacts`.
 * @param dict - the declared fields.
 * @returns the schema.
 * @throws Error naming the undeclared key and the declared fields, at validation.
 */
export function closedObject<T>(name: string, dict: Record<string, z>): z<T> {
  return z.transform(z.object(dict), (value: Record<string, unknown>) => {
    const unknown = Object.keys(value).find(key => !Object.hasOwn(dict, key))
    if (unknown !== undefined) throw new Error(`${name} has no field ${unknown}; its fields: ${Object.keys(dict).join(', ')}.`)
    return value
  }) as z<T>
}
