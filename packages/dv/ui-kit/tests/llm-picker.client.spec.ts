// @vitest-environment jsdom
/** The LLM picker choices default to the first few models of each provider and persist explicit switches. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  LLM_PICKER_DEFAULT_COUNT, llmPickerEnabled, llmPickerKey, readLlmPickerChoices, setLlmPickerModel, subscribeLlmPicker,
} from '../src/client/llm-picker.ts'

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { vi.restoreAllMocks() })

const group = (id: string, count: number) => ({ id, models: Array.from({ length: count }, (_, index) => ({ id: `m${index}` })) })

it('offers the first few models of each provider until a switch overrides them', () => {
  const groups = [group('a', 5), group('b', 2)]
  expect(LLM_PICKER_DEFAULT_COUNT).toBe(3)
  expect([...llmPickerEnabled({}, groups)]).toEqual(['a/m0', 'a/m1', 'a/m2', 'b/m0', 'b/m1'])
  expect([...llmPickerEnabled({ 'a/m4': true, 'a/m0': false }, groups)]).toEqual(['a/m1', 'a/m2', 'a/m4', 'b/m0', 'b/m1'])
  expect(llmPickerKey('a', 'x/y')).toBe('a/x/y')
})

it('stores switches, keeps the read result stable until the text changes, and notifies subscribers', () => {
  const listener = vi.fn()
  const stop = subscribeLlmPicker(listener)
  expect(readLlmPickerChoices()).toBe(readLlmPickerChoices())
  setLlmPickerModel('a/m3', true)
  setLlmPickerModel('a/m0', false)
  expect(readLlmPickerChoices()).toEqual({ 'a/m3': true, 'a/m0': false })
  expect(listener).toHaveBeenCalledTimes(2)
  window.dispatchEvent(new StorageEvent('storage', { key: 'dv.llm-picker' }))
  window.dispatchEvent(new StorageEvent('storage', { key: 'other' }))
  expect(listener).toHaveBeenCalledTimes(3)
  stop()
  setLlmPickerModel('a/m1', true)
  expect(listener).toHaveBeenCalledTimes(3)
})

it('reads stored text that is not a map of booleans as no choices, and cleared storage as none', () => {
  window.localStorage.setItem('dv.llm-picker', '{"a/m1":true}')
  expect(readLlmPickerChoices()).toEqual({ 'a/m1': true })
  window.localStorage.clear()
  expect(readLlmPickerChoices()).toEqual({})
  for (const raw of ['not json', '[true]', '5', 'null', '{"a/m0":"yes","a/m1":true}']) {
    window.localStorage.setItem('dv.llm-picker', raw)
    expect(readLlmPickerChoices()).toEqual(raw.includes('a/m1') ? { 'a/m1': true } : {})
  }
})
