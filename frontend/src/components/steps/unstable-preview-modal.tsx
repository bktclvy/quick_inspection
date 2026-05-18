/**
 * 合成された不安定サンプル画像をサムネ表示するモーダル。
 */
import { useEffect, useState, useCallback } from 'react'
import { productsApi } from '@/api/products'
import { Toast } from '@/components/layout/Toast'

interface Props {
  productId: string
  roiId: string
  roiName: string
  onClose: () => void
}

export function UnstablePreviewModal({ productId, roiId, roiName, onClose }: Props) {
  const [files, setFiles] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [seed, setSeed] = useState(0)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const res = await productsApi.listUnstablePreviews(productId, roiId, 8)
      setFiles(res.files)
    } catch {
      Toast.error('プレビュー取得に失敗しました')
      setFiles([])
    } finally {
      setBusy(false)
    }
  }, [productId, roiId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(20, 16, 32, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 32,
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 760, maxHeight: '85vh',
          background: '#fff', borderRadius: 16, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}>
        {/* ヘッダー */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '16px 20px', borderBottom: '1px solid #f0ede9',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#a855f7',
                          textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              不安定サンプルプレビュー
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#3d3654', marginTop: 2 }}>
              {roiName}
            </div>
          </div>
          <button onClick={() => { setSeed((k) => k + 1); load() }}
            disabled={busy}
            style={{
              height: 30, padding: '0 12px', fontSize: 12, fontWeight: 600,
              color: '#7c2d92', background: '#faf5ff',
              border: '1.5px solid #ede9fe', borderRadius: 8,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}>↻ 別サンプル</button>
          <button onClick={onClose}
            style={{
              marginLeft: 8, width: 30, height: 30, borderRadius: 8,
              background: '#fff', border: '1.5px solid #e8e4df',
              color: '#7c7494', cursor: 'pointer', fontSize: 16,
            }}>×</button>
        </div>

        {/* 本体 */}
        <div style={{ padding: 20, overflowY: 'auto' }}>
          {busy && files === null ? (
            <p style={{ fontSize: 13, color: '#9994a8', textAlign: 'center', padding: '40px 0' }}>
              読み込み中...
            </p>
          ) : files && files.length > 0 ? (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
            }}>
              {files.map((fn) => (
                <div key={`${fn}-${seed}`} style={{
                  position: 'relative', aspectRatio: '1/1',
                  borderRadius: 10, overflow: 'hidden',
                  background: '#faf9f7', border: '1px solid #ede9fe',
                }}>
                  <img src={productsApi.unstablePreviewUrl(productId, roiId, fn) + `?t=${seed}`}
                    alt={fn}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <span style={{
                    position: 'absolute', bottom: 4, left: 4,
                    fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
                    color: '#fff', background: 'rgba(0,0,0,0.5)',
                    padding: '1px 5px', borderRadius: 4,
                  }}>{fn.replace(/^synth_/, '').replace(/\.jpg$/, '')}</span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: '#9994a8', textAlign: 'center', padding: '40px 0' }}>
              合成サンプルがありません。先に「生成」を実行してください。
            </p>
          )}
        </div>

        {/* フッター */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid #f0ede9',
          fontSize: 11, color: '#9994a8', background: '#faf9ff',
        }}>
          見え方に違和感がある場合は、合成パターンや倍率を変えて再生成してください。
        </div>
      </div>
    </div>
  )
}
