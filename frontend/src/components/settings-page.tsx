import { useEffect, useState } from 'react'
import { useWorkerStore } from '@/stores/workerStore'
import { syncApi } from '@/api/sync'
import type { AppConfig } from '@/api/sync'
import type { Worker } from '@/types/worker'

type SettingsTab = 'workers' | 'sync'

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('workers')

  return (
    <div style={{
      height: '100%', overflow: 'auto',
      background: '#f7f5f2',
      padding: '24px 32px',
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a1625', margin: '0 0 4px' }}>
          設定
        </h1>
        <p style={{ fontSize: 13, color: '#9994a8', margin: '0 0 24px' }}>
          作業者マスタの登録・このPCの設定・他のPCとの同期方法
        </p>

        {/* タブナビ */}
        <div style={{
          display: 'flex', gap: 4,
          background: '#ffffff', borderRadius: 12, padding: 4,
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          marginBottom: 20,
          width: 'fit-content',
        }}>
          {([
            { id: 'workers', label: '作業者マスタ' },
            { id: 'sync', label: 'PC・同期' },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 22px', borderRadius: 9, border: 'none',
                fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                ...(tab === t.id
                  ? { background: 'linear-gradient(135deg, #6366f1, #7c3aed)', color: '#fff' }
                  : { background: 'transparent', color: '#7c7494' }),
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'workers' && <WorkersSection />}
        {tab === 'sync' && <SyncSection />}
      </div>
    </div>
  )
}

/* ─── 作業者マスタ ───────────────────────── */

function WorkersSection() {
  const workers      = useWorkerStore((s) => s.workers)
  const loading      = useWorkerStore((s) => s.loading)
  const loadWorkers  = useWorkerStore((s) => s.loadWorkers)
  const createWorker = useWorkerStore((s) => s.createWorker)
  const updateWorker = useWorkerStore((s) => s.updateWorker)
  const deleteWorker = useWorkerStore((s) => s.deleteWorker)

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [editing, setEditing] = useState<Worker | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadWorkers().catch(() => {})
  }, [loadWorkers])

  const reset = () => { setName(''); setCode(''); setEditing(null); setError(null) }

  const handleSubmit = async () => {
    if (!name.trim()) { setError('氏名を入力してください'); return }
    setBusy(true); setError(null)
    try {
      if (editing) await updateWorker(editing.id, { name: name.trim(), code: code.trim() || null })
      else await createWorker(name.trim(), code.trim() || null)
      reset()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const handleEdit = (w: Worker) => {
    setEditing(w); setName(w.name); setCode(w.code ?? ''); setError(null)
  }

  const handleDelete = async (w: Worker) => {
    if (!window.confirm(`${w.name} を削除します。よろしいですか？`)) return
    setBusy(true)
    try {
      await deleteWorker(w.id)
      if (editing?.id === w.id) reset()
    } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
      {/* 一覧 */}
      <div style={card}>
        <h2 style={cardTitle}>登録済み作業者</h2>
        {loading ? (
          <p style={emptyText}>読み込み中…</p>
        ) : workers.length === 0 ? (
          <p style={emptyText}>まだ作業者が登録されていません。右の「追加」フォームから登録してください。</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {workers.map((w) => (
              <div key={w.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px',
                background: editing?.id === w.id ? '#f5f3ff' : '#faf9f7',
                border: editing?.id === w.id ? '1.5px solid #6366f1' : '1.5px solid #ebe7e2',
                borderRadius: 10,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #c4b5fd, #6366f1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 800, color: '#fff',
                }}>
                  {w.name.charAt(0)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1625' }}>{w.name}</div>
                  {w.code && (
                    <div style={{ fontSize: 11, color: '#9994a8', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
                      {w.code}
                    </div>
                  )}
                </div>
                <button onClick={() => handleEdit(w)} style={btnSecondary}>編集</button>
                <button onClick={() => handleDelete(w)} style={btnDanger}>削除</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* フォーム */}
      <div style={card}>
        <h2 style={cardTitle}>{editing ? '作業者を編集' : '作業者を追加'}</h2>
        <Field label="氏名">
          <input
            type="text" placeholder="例: 田中 太郎"
            value={name} onChange={(e) => setName(e.target.value)}
            disabled={busy} style={inputStyle}
          />
        </Field>
        <Field label="社員番号 / コード（任意）">
          <input
            type="text" placeholder="例: EMP001"
            value={code} onChange={(e) => setCode(e.target.value)}
            disabled={busy} style={inputStyle}
          />
        </Field>
        {error && <p style={errorBox}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {editing && (
            <button onClick={reset} disabled={busy} style={btnSecondaryLg}>キャンセル</button>
          )}
          <button
            onClick={handleSubmit}
            disabled={busy || !name.trim()}
            style={{
              ...btnPrimary,
              flex: 2,
              opacity: busy || !name.trim() ? 0.5 : 1,
              cursor: busy || !name.trim() ? 'default' : 'pointer',
            }}
          >
            {busy ? '保存中…' : editing ? '更新' : '追加'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── PC・同期設定 ───────────────────────── */

function SyncSection() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null)

  useEffect(() => {
    syncApi.getConfig().then(setConfig).catch(() => {})
  }, [])

  const patch = (updates: Partial<AppConfig>) => {
    setConfig((prev) => prev ? { ...prev, ...updates } : prev)
    setSavedMsg(null)
  }

  const save = async () => {
    if (!config) return
    setSaving(true); setSavedMsg(null)
    try {
      const result = await syncApi.updateConfig(config)
      setConfig(result)
      setSavedMsg('保存しました')
      setTimeout(() => setSavedMsg(null), 3000)
    } catch (e: unknown) {
      setSavedMsg(e instanceof Error ? `保存失敗: ${e.message}` : '保存失敗')
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true); setTestResult(null)
    try {
      const r = await syncApi.testConnection()
      setTestResult(r)
    } catch (e: unknown) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'テスト失敗' })
    } finally {
      setTesting(false)
    }
  }

  if (!config) return <div style={card}><p style={emptyText}>読み込み中…</p></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* PC識別 */}
      <div style={card}>
        <h2 style={cardTitle}>このPC</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="PC ID（自動生成・変更不可）">
            <input type="text" value={config.pc_id} readOnly
              style={{ ...inputStyle, background: '#f3f1ee', color: '#9994a8',
                       fontFamily: "'JetBrains Mono', monospace" }} />
          </Field>
          <Field label="PC名（表示用、運用で識別しやすい名前）">
            <input
              type="text" placeholder="例: ライン1-A卓"
              value={config.pc_label}
              onChange={(e) => patch({ pc_label: e.target.value })}
              style={inputStyle}
            />
          </Field>
        </div>
      </div>

      {/* 同期モード */}
      <div style={card}>
        <h2 style={cardTitle}>同期モード</h2>
        <p style={{ fontSize: 12, color: '#7c7494', margin: '0 0 16px' }}>
          複数のPCで作業者マスタや検査ログを共有する方法を選びます。1台だけで使うなら「スタンドアロン」でOK。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ModeOption
            checked={config.mode === 'standalone'}
            onChange={() => patch({ mode: 'standalone' })}
            title="スタンドアロン"
            desc="このPC内で完結。他のPCと共有しない。"
            disabled={false}
          />
          <ModeOption
            checked={config.mode === 'shared_folder'}
            onChange={() => patch({ mode: 'shared_folder' })}
            title="共有フォルダ"
            desc="LAN内のネットワーク共有先（NAS等）にデータを置く。Phase 2 で実装予定。"
            disabled
          />
          <ModeOption
            checked={config.mode === 'cloud_sync'}
            onChange={() => patch({ mode: 'cloud_sync' })}
            title="クラウド同期フォルダ"
            desc="OneDrive / GoogleDrive などの同期フォルダ経由。Phase 2 で実装予定。"
            disabled
          />
          <ModeOption
            checked={config.mode === 'master'}
            onChange={() => patch({ mode: 'master' })}
            title="マスタ役PC（このPCがマスタ）"
            desc="他のPCがこのPCにHTTP接続してきてデータをやり取り。Phase 2 で実装予定。"
            disabled
          />
          <ModeOption
            checked={config.mode === 'client'}
            onChange={() => patch({ mode: 'client' })}
            title="クライアント（マスタ役PCに接続）"
            desc="別のマスタ役PCに接続。Phase 2 で実装予定。"
            disabled
          />
        </div>

        {/* モード別追加設定 */}
        {(config.mode === 'shared_folder' || config.mode === 'cloud_sync') && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f0ede9' }}>
            <Field label={config.mode === 'shared_folder' ? '共有フォルダのパス' : 'クラウド同期フォルダのパス'}>
              <input
                type="text"
                placeholder={config.mode === 'shared_folder' ? '\\\\server\\share\\quick_inspection' : 'C:\\Users\\you\\OneDrive\\quick_inspection'}
                value={config.mode === 'shared_folder' ? config.shared_path : config.cloud_sync_path}
                onChange={(e) =>
                  config.mode === 'shared_folder'
                    ? patch({ shared_path: e.target.value })
                    : patch({ cloud_sync_path: e.target.value })
                }
                style={inputStyle}
              />
            </Field>
          </div>
        )}

        {config.mode === 'client' && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f0ede9' }}>
            <Field label="マスタ役PCのURL">
              <input
                type="text" placeholder="例: http://192.168.1.10:8000"
                value={config.master_url}
                onChange={(e) => patch({ master_url: e.target.value })}
                style={inputStyle}
              />
            </Field>
          </div>
        )}

        {/* テスト結果 */}
        {testResult && (
          <div style={{
            marginTop: 16, padding: '10px 14px', borderRadius: 10,
            background: testResult.ok ? '#f0fdf4' : '#fef2f2',
            border: `1.5px solid ${testResult.ok ? '#86efac' : '#fca5a5'}`,
            color: testResult.ok ? '#059669' : '#dc2626',
            fontSize: 13, fontWeight: 600,
          }}>
            {testResult.ok ? '✓ ' : '✗ '}{testResult.message ?? (testResult.ok ? '接続成功' : '接続失敗')}
          </div>
        )}
        {savedMsg && (
          <div style={{
            marginTop: 12, padding: '8px 14px', borderRadius: 8,
            background: '#f0fdf4', color: '#059669',
            fontSize: 12, fontWeight: 600, textAlign: 'center',
          }}>{savedMsg}</div>
        )}

        {/* アクション */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={test} disabled={testing || saving} style={{ ...btnSecondaryLg, flex: 1 }}>
            {testing ? '接続テスト中…' : '接続テスト'}
          </button>
          <button onClick={save} disabled={saving || testing} style={{ ...btnPrimary, flex: 1 }}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModeOption({ checked, onChange, title, desc, disabled }: {
  checked: boolean; onChange: () => void; title: string; desc: string; disabled: boolean
}) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 14px', borderRadius: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      border: checked ? '2px solid #6366f1' : '2px solid #ebe7e2',
      background: checked ? '#f5f3ff' : disabled ? '#faf9f7' : '#ffffff',
      opacity: disabled ? 0.55 : 1,
    }}>
      <input
        type="radio" checked={checked} onChange={onChange} disabled={disabled}
        style={{ marginTop: 2, accentColor: '#6366f1' }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1625' }}>
          {title}
          {disabled && (
            <span style={{
              marginLeft: 8, fontSize: 10, fontWeight: 700,
              padding: '2px 8px', borderRadius: 6,
              background: '#fef3c7', color: '#92400e',
            }}>未実装</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#7c7494', marginTop: 3 }}>{desc}</div>
      </div>
    </label>
  )
}

/* ─── 共通スタイル ──────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#7c7494',
                      textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const card: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: 14,
  padding: '20px 22px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  border: '1px solid #f0ede9',
}

const cardTitle: React.CSSProperties = {
  fontSize: 15, fontWeight: 800, color: '#1a1625', margin: '0 0 14px',
}

const emptyText: React.CSSProperties = {
  fontSize: 13, color: '#9994a8', textAlign: 'center', margin: '24px 0',
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 38, padding: '0 12px',
  fontSize: 13, fontWeight: 500,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#1a1625', background: '#faf9f7',
  border: '1.5px solid #e8e4df', borderRadius: 10,
  outline: 'none',
  boxSizing: 'border-box',
}

const btnPrimary: React.CSSProperties = {
  height: 40, padding: '0 18px',
  fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
  border: 'none', borderRadius: 10,
  background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
  color: '#fff', cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
}

const btnSecondary: React.CSSProperties = {
  height: 30, padding: '0 12px',
  fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
  background: '#fff', border: '1.5px solid #e8e4df',
  borderRadius: 8, cursor: 'pointer', color: '#5c5470',
}

const btnSecondaryLg: React.CSSProperties = {
  height: 40, padding: '0 18px',
  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  background: '#fff', border: '1.5px solid #e8e4df',
  borderRadius: 10, cursor: 'pointer', color: '#5c5470',
}

const btnDanger: React.CSSProperties = {
  height: 30, padding: '0 12px',
  fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
  background: '#fef2f2', border: '1.5px solid #fca5a5',
  borderRadius: 8, cursor: 'pointer', color: '#dc2626',
}

const errorBox: React.CSSProperties = {
  fontSize: 12, color: '#dc2626',
  padding: '8px 10px', background: '#fef2f2',
  borderRadius: 8, margin: '0 0 10px',
}
