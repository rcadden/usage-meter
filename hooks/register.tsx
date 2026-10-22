import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'usage-meter', key: 'limits' } as const, [] as Limit[])
const now = atom({ plugin: 'usage-meter', key: 'now' } as const, 0)

const LABELS: Record<string, string> = { five_hour: '5H', seven_day: '7D' }

const ring = (pct: number) =>
  pct >= 87.5 ? '●' : pct >= 62.5 ? '◕' : pct >= 37.5 ? '◑' : pct >= 12.5 ? '◔' : '○'

function ringSvg(pct: number, hot: boolean) {
  const r = 11
  const c = 2 * Math.PI * r
  const arc = (Math.min(100, Math.max(0, pct)) / 100) * c
  const color = hot ? '#d92d20' : '#c2410c'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
    `<circle cx="14" cy="14" r="${r}" fill="none" stroke="#808080" stroke-opacity="0.45" stroke-width="4"/>` +
    `<circle cx="14" cy="14" r="${r}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" ` +
    `stroke-dasharray="${arc} ${c}" transform="rotate(-90 14 14)"/></svg>`
  )
}

const timeLeft =(resetsAt: string | undefined, at: number) => {
  if (!resetsAt) return ''
  const mins = Math.max(0, Math.round((Date.parse(resetsAt) - at) / 60000))
  const d = Math.floor(mins / 1440)
  const hr = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  const text = d > 0 ? `${d}d ${hr}h` : hr > 0 ? `${hr}h ${m}m` : `${m}m`
  return `${text} left`
}

async function refresh($: EngineInterface) {
  const usage = await $.session.usage()
  await update($, limits, () => usage.rateLimits as Limit[])
  await update($, now, () => Date.now())
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($)
    $.clock.every(60000, () => refresh($))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, limits, () => e.rateLimits as Limit[])
    await update($, now, () => Date.now())
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rows = (await read($, limits)).filter(l => LABELS[l.kind])
    if (e.props.hasSurvey) return next(e)

    const at = await read($, now)
    const { Box, Text } = $.ui.resolve(e)

    if (rows.length === 0) {
      return (
        <Box>
          <Text size="body" weight="medium">○ 5H –  ○ 7D –  (waiting for usage data)</Text>
        </Box>
      )
    }

    const Svg = (e.surface === 'terminal' ? undefined : (($.ui.resolve(e) as any).Svg)) as any

    return (
      <Box flexDirection="row" alignItems="center" gap={3}>
        {rows.map(l => {
          const hot = l.percentUsed >= 90
          return (
            <Box key={l.kind} flexDirection="row" alignItems="center" gap={1}>
              {Svg ? (
                <Svg
                  source={ringSvg(l.percentUsed, hot)}
                  alt={`${LABELS[l.kind]} usage ${Math.round(l.percentUsed)}%`}
                  width={18}
                  height={18}
                />
              ) : (
                <Text size="body">{ring(l.percentUsed)}</Text>
              )}
              <Text size="body" weight="semibold" color={hot ? 'red' : undefined}>
                {LABELS[l.kind]} {Math.round(l.percentUsed)}%
              </Text>
              {l.resetsAt ? (
                <Text size="body" weight="medium" color={hot ? 'red' : undefined}>
                  {timeLeft(l.resetsAt, at)}
                </Text>
              ) : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}
