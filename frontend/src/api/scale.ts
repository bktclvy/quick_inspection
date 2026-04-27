const BASE = '/api/scale'

export interface ScaleStatus {
  port_open: boolean
  data_age_ms: number | null
  latest: {
    value_g: number
    stable: boolean
    overload: boolean
  } | null
}

export interface ScaleConfig {
  port: string
  baudrate: number
  data_bits: number
  parity: string
  stop_bits: number
  read_timeout_ms: number
  stability_timeout_ms: number
  tare_command: string
  enabled: boolean
}

export interface WeighResult {
  ok: boolean
  measured_g: number
  deviation_g: number
  estimated_qty_delta: number | null
}

export const scaleApi = {
  status: (): Promise<ScaleStatus> =>
    fetch(BASE + '/status').then((r) => r.json()),

  getConfig: (): Promise<ScaleConfig> =>
    fetch(BASE + '/config').then((r) => r.json()),

  updateConfig: (body: Partial<ScaleConfig>): Promise<ScaleConfig> =>
    fetch(BASE + '/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json()),

  getPorts: (): Promise<{ ports: Array<{ device: string; description: string }> }> =>
    fetch(BASE + '/ports').then((r) => r.json()),

  reconnect: (): Promise<{ connected: boolean }> =>
    fetch(BASE + '/reconnect', { method: 'POST' }).then((r) => r.json()),

  tare: (): Promise<{ ok: boolean; tared_at_g: number | null; duration_ms: number }> =>
    fetch(BASE + '/tare', { method: 'POST' }).then((r) => r.json()),

  weigh: (body: {
    expected_g: number
    tolerance_g: number
    timeout_ms?: number
    box_qty?: number
  }): Promise<WeighResult> =>
    fetch(BASE + '/weigh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json()),
}
