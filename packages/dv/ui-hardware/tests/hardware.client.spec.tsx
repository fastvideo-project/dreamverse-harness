// @vitest-environment jsdom
/** Hardware forms use existing settings and credential operations and preserve refused drafts. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { WorkerConfig, WorkerView } from '@dv/hardware/types'
import { HardwarePage, type DeviceModels } from '../src/client/HardwarePage.tsx'

let language: string
beforeEach(() => { language = document.documentElement.lang; document.documentElement.lang = 'en' })
afterEach(() => { cleanup(); document.documentElement.lang = language })

class FixtureForm<T> implements ConfigForm<T> {
  constructor(private readonly snapshot: ConfigFormSnapshot<T>) {}
  getSnapshot(): ConfigFormSnapshot<T> { return this.snapshot }
  subscribe(): () => void { this.getSnapshot(); return () => {} }
  mutate = vi.fn(async () => true)
  set = vi.fn(async () => true)
  unset = vi.fn(async () => true)
}
function form<T>(value: T): FixtureForm<T> {
  return new FixtureForm({ status: 'ready', value, base: {}, user: {}, revision: 4, writable: true, mode: 'host' })
}
const saved: WorkerConfig = { label: 'Workstation', provider: 'fastvideo', enabled: true, transport: 'api',
  baseUrl: 'http://127.0.0.1:18000', credentialRef: 'SAVED_KEY', sshHost: '', remoteHost: '127.0.0.1', remotePort: 18000 }
const state: WorkerView = { id: 'workstation', label: 'Workstation', provider: 'fastvideo', transport: 'api', enabled: true,
  status: 'ready', reachable: true, busy: false, loadedModel: 'pika', loadingModel: null }
const noModels: DeviceModels = { catalog: async () => [], action: async () => {} }

it('saves an SSH alias with revision fencing, keeping a blank API key unchanged', async () => {
  const config = form({ workers: { workstation: saved } })
  const storeCredential = vi.fn(async () => {})
  render(<HardwarePage models={noModels} removeCredential={async () => {}}
    runpodPods={async () => []} form={config} routing={form({ useHardware: false })} check={async () => [state]}
    storeCredential={storeCredential} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: /Workstation/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByLabelText('Connection'), { target: { value: 'ssh' } })
  fireEvent.change(screen.getByLabelText('SSH host alias'), { target: { value: 'gpu-box' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save and check' }))
  await act(async () => {})
  expect(config.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['workers', 'workstation'],
    value: { ...saved, transport: 'ssh', sshHost: 'gpu-box' } }], 4)
  expect(storeCredential).not.toHaveBeenCalled()
  expect(screen.getByRole('status').textContent).toBe('Worker saved.')
})

it('stores a new API key only in the existing credential service and persists its reference', async () => {
  const config = form({ workers: {} })
  const storeCredential = vi.fn(async () => {})
  render(<HardwarePage models={noModels} removeCredential={async () => {}}
    runpodPods={async () => []} form={config} routing={form({ useHardware: false })} check={async () => []}
    storeCredential={storeCredential} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Add device' }))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Cloud GPU' } })
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'fixture-token' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save and check' }))
  await act(async () => {})
  expect(storeCredential).toHaveBeenCalledWith(expect.stringMatching(/^DV_WORKER_CLOUD_GPU_KEY_[a-f0-9_]+$/), 'fixture-token')
  expect(JSON.stringify(vi.mocked(config.mutate).mock.calls)).not.toContain('fixture-token')
  expect(JSON.stringify(vi.mocked(config.mutate).mock.calls)).toContain('DV_WORKER_CLOUD_GPU_KEY')
})

it('keeps a refused edit visible and prevents removing a busy worker', async () => {
  const config = form({ workers: { workstation: saved } })
  vi.mocked(config.mutate).mockResolvedValue(false)
  render(<HardwarePage models={noModels} removeCredential={async () => {}}
    runpodPods={async () => []} form={config} routing={form({ useHardware: true })} check={async () => [{ ...state, busy: true, status: 'busy' }]}
    storeCredential={async () => {}} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: /Workstation/ }))
  expect(screen.getByRole('button', { name: 'Remove' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save and check' }))
  await act(async () => {})
  expect(screen.getByRole('alert').textContent).toContain('Settings changed elsewhere')
  expect(screen.getByLabelText('Name')).toBeTruthy()
})

it('loads an installed model from the expanded device without generating', async () => {
  const action = vi.fn(async () => {})
  const catalog = vi.fn(async () => [{ id: 'omni', tasks: ['ref2va'], installed: true, loaded: false }])
  render(<HardwarePage models={{ catalog, action }} removeCredential={async () => {}}
    runpodPods={async () => []} form={form({ workers: { workstation: saved } })} routing={form({ useHardware: true })}
    check={async () => [state]} storeCredential={async () => {}} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: /Workstation/ }))
  await act(async () => {})
  expect(catalog).toHaveBeenCalledWith('workstation')
  expect(screen.getByText('REF2VA')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Load' }))
  await act(async () => {})
  expect(action).toHaveBeenCalledWith('workstation', 'load', 'omni', 'ref2va')
  expect(catalog).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('status').textContent).toBe('Model action completed.')
})

it('offers retry for a failed model catalog and keeps a busy device from loading', async () => {
  const catalog = vi.fn().mockRejectedValueOnce(new Error('catalog unavailable'))
    .mockResolvedValue([{ id: 'omni', tasks: ['ref2va'], installed: true, loaded: false }])
  render(<HardwarePage models={{ catalog, action: async () => {} }} removeCredential={async () => {}}
    runpodPods={async () => []} form={form({ workers: { workstation: saved } })} routing={form({ useHardware: true })}
    check={async () => [{ ...state, busy: true, status: 'busy' }]} storeCredential={async () => {}} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: /Workstation/ }))
  await act(async () => {})
  expect(screen.getByRole('alert').textContent).toContain('catalog unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await act(async () => {})
  expect(screen.getByRole('button', { name: 'Load' }).hasAttribute('disabled')).toBe(true)
})

it('keeps connection checks recoverable and distinguishes local and hosted endpoints', async () => {
  const check = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([])
  render(<HardwarePage models={noModels} removeCredential={async () => {}}
    runpodPods={async () => []} form={form({ workers: {} })} routing={form({ useHardware: true })} check={check}
    storeCredential={async () => {}} />)
  await act(async () => {})
  expect(screen.getByRole('alert').textContent).toContain('Could not check connections')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await act(async () => {})
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Add device' }))
  expect(screen.getByText('The GPU and FastVideo server run on the machine hosting this harness.')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Connection'), { target: { value: 'api' } })
  expect(screen.getByText(/compatible Modal or RunPod/)).toBeTruthy()
})

it('requires confirmation before removing a connection and keeps cancellation reversible', async () => {
  const config = form({ workers: { workstation: saved } })
  render(<HardwarePage models={noModels} removeCredential={async () => {}}
    runpodPods={async () => []} form={config} routing={form({ useHardware: true })} check={async () => [state]}
    storeCredential={async () => {}} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: /Workstation/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(config.mutate).not.toHaveBeenCalled()
  expect(screen.getByText(/does not delete the server/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('button', { name: 'Remove connection' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }))
  await act(async () => {})
  expect(config.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['workers'], value: {} }], 4)
})

it('connects an existing RunPod HTTP port without using its account key as a worker key', async () => {
  const config = form({ workers: {} })
  const storeCredential = vi.fn(async () => {})
  const discover = vi.fn(async () => [{ id: 'pod123', name: 'Studio Pod', status: 'RUNNING',
    endpoints: [{ port: 18000, baseUrl: 'https://pod123-18000.proxy.runpod.net' }] }])
  render(<HardwarePage models={noModels} removeCredential={async () => {}} form={config}
    routing={form({ useHardware: false })} check={async () => []}
    storeCredential={storeCredential} runpodPods={discover} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Add device' }))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'RunPod GPU' } })
  fireEvent.change(screen.getByLabelText('Connection'), { target: { value: 'runpod' } })
  fireEvent.change(screen.getByLabelText('RunPod account API key'), { target: { value: 'account-fixture-key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Find my Pods' }))
  await act(async () => {})
  expect(discover).toHaveBeenCalledWith('DV_RUNPOD_API_KEY')
  expect(storeCredential).toHaveBeenCalledWith('DV_RUNPOD_API_KEY', 'account-fixture-key')
  fireEvent.change(screen.getByLabelText('Pod and FastVideo port'), { target: { value: 'https://pod123-18000.proxy.runpod.net' } })
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'worker-fixture-key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save and check' }))
  await act(async () => {})
  expect(storeCredential).toHaveBeenCalledWith(expect.stringMatching(/^DV_WORKER_RUNPOD_GPU_KEY_[a-f0-9_]+$/), 'worker-fixture-key')
  const written = JSON.stringify(config.mutate.mock.calls)
  expect(written).toContain('https://pod123-18000.proxy.runpod.net')
  expect(written).not.toContain('account-fixture-key')
  expect(written).not.toContain('worker-fixture-key')
  expect(written).not.toContain('DV_RUNPOD_API_KEY')
})

it('keeps an existing worker credential intact and removes only a refused save’s new key', async () => {
  const config = form({ workers: { workstation: saved } })
  config.mutate.mockResolvedValue(false)
  const store = vi.fn(async (_ref: string, _value: string) => {})
  const remove = vi.fn(async (_ref: string) => {})
  render(<HardwarePage models={noModels} form={config} routing={form({ useHardware: true })} check={async () => [state]}
    storeCredential={store} removeCredential={remove} runpodPods={async () => []} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: /Workstation/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'new-fixture-token' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save and check' }))
  await act(async () => {})
  expect(store).not.toHaveBeenCalledWith('SAVED_KEY', expect.anything())
  const ref = store.mock.calls[0]?.[0]
  expect(ref).toMatch(/^DV_WORKER_WORKSTATION_KEY_[a-f0-9_]+$/)
  expect(remove).toHaveBeenCalledWith(ref)
  expect(screen.getByLabelText('API key').getAttribute('value')).toBe('new-fixture-token')
  expect(screen.getByRole('alert').textContent).toContain('changed')
})

it('unloads a resident model, reports a refused model action, and shows an empty catalog note', async () => {
  const action = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('device busy'))
  const catalog = vi.fn().mockResolvedValue([{ id: 'omni', tasks: [], installed: true, loaded: true }])
  const routing = form({ useHardware: false })
  render(<HardwarePage models={{ catalog, action }} removeCredential={async () => {}}
    runpodPods={async () => []} form={form({ workers: { workstation: saved } })} routing={routing}
    check={async () => [state]} storeCredential={async () => {}} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: /Workstation/ }))
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Unload' }))
  await act(async () => {})
  expect(action).toHaveBeenCalledWith('workstation', 'unload', 'omni', '')
  fireEvent.click(screen.getByRole('button', { name: 'Unload' }))
  await act(async () => {})
  expect(screen.getByRole('alert').textContent).toContain('device busy')
  fireEvent.click(screen.getByRole('switch', { name: /Use configured workers for FastVideo/ }))
  expect(routing.set).toHaveBeenCalledWith('useHardware', true)
  vi.mocked(routing.set).mockResolvedValueOnce(false)
  fireEvent.click(screen.getByRole('switch', { name: /Use configured workers for FastVideo/ }))
  await act(async () => {})
  vi.mocked(routing.set).mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('switch', { name: /Use configured workers for FastVideo/ }))
  await act(async () => {})
  expect(screen.getByRole('alert').textContent).toContain('offline')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }))
  await act(async () => {})
  expect(catalog).toHaveBeenCalledTimes(3)
})

it('shows the empty model note for a device with no installed models', async () => {
  render(<HardwarePage models={noModels} removeCredential={async () => {}}
    runpodPods={async () => []} form={form({ workers: { workstation: saved } })} routing={form({ useHardware: false })}
    check={async () => []} storeCredential={async () => {}} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: /Workstation/ }))
  await act(async () => {})
  expect(screen.getByText('No installed models found')).toBeTruthy()
})
