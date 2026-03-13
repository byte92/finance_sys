'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type SeriesMarker,
  type MouseEventParams,
} from 'lightweight-charts'
import type { Market, Trade } from '@/types'

type KlineItem = {
  time: number
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type MappedTrade = Trade & {
  mappedDate: string
  mappedTime: number
}

const RANGES = [
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '6M', value: '6mo' },
  { label: '1Y', value: '1y' },
  { label: '3Y', value: '3y' },
]

const INTERVALS = [
  { label: '1D', value: '1d' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '60m', value: '60m' },
]

export default function StockKline({
  symbol,
  market,
  trades,
}: {
  symbol: string
  market: Market
  trades: Trade[]
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const ma5Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ma10Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ma20Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const tradeLineRef = useRef<ISeriesApi<'Line'> | null>(null)
  const holdingRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  const dataRef = useRef<KlineItem[]>([])
  const mappedTradesRef = useRef<MappedTrade[]>([])

  const [range, setRange] = useState('6mo')
  const [interval, setInterval] = useState('1d')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<string>('')
  const [data, setData] = useState<KlineItem[]>([])
  const [hover, setHover] = useState<{
    x: number
    y: number
    date: string
    candle?: KlineItem
    trades: MappedTrade[]
  } | null>(null)

  const minuteSupported = market === 'A' || market === 'FUND'

  useEffect(() => {
    if (!minuteSupported && interval !== '1d') {
      setInterval('1d')
    }
  }, [minuteSupported, interval])

  const mappedTrades = useMemo<MappedTrade[]>(() => {
    if (!data.length) return []
    const dateList = data.map((d) => d.date)
    const dateSet = new Set(dateList)
    const firstTimeByDate = new Map<string, number>()
    for (const d of data) {
      if (!firstTimeByDate.has(d.date)) firstTimeByDate.set(d.date, d.time)
    }

    return trades
      .filter((t) => t.type === 'BUY' || t.type === 'SELL')
      .map((t) => {
        let mappedDate = t.date
        if (!dateSet.has(mappedDate)) {
          mappedDate = dateList.find((d) => d >= t.date) || dateList[dateList.length - 1]
        }
        if (!mappedDate) return null
        const mappedTime = firstTimeByDate.get(mappedDate)
        if (!mappedTime) return null
        return { ...t, mappedDate, mappedTime }
      })
      .filter((x): x is MappedTrade => Boolean(x))
      .sort((a, b) => a.mappedTime - b.mappedTime)
  }, [data, trades])

  const tradeMarkers = useMemo(() => {
    if (!mappedTrades.length) return [] as SeriesMarker<any>[]
    const markers: SeriesMarker<any>[] = []

    for (const t of mappedTrades) {
      markers.push({
        time: t.mappedTime as any,
        position: t.type === 'BUY' ? 'belowBar' : 'aboveBar',
        color: t.type === 'BUY' ? '#ef4444' : '#22c55e',
        shape: t.type === 'BUY' ? 'arrowUp' : 'arrowDown',
        text: `${t.type === 'BUY' ? '买' : '卖'} ${t.quantity}`,
      })
    }

    return markers
  }, [mappedTrades])

  const ma5Data = useMemo(() => calcMA(data, 5), [data])
  const ma10Data = useMemo(() => calcMA(data, 10), [data])
  const ma20Data = useMemo(() => calcMA(data, 20), [data])

  const tradeLineData = useMemo<LineData<any>[]>(() => {
    const byTime = new Map<number, number>()
    for (const t of mappedTrades) {
      byTime.set(t.mappedTime, t.price)
    }
    return Array.from(byTime.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => ({ time: time as any, value }))
  }, [mappedTrades])

  const holdingData = useMemo<HistogramData<any>[]>(() => {
    if (!data.length) return []
    const deltaByDate = new Map<string, number>()
    for (const t of mappedTrades) {
      const delta = t.type === 'BUY' ? t.quantity : -t.quantity
      deltaByDate.set(t.mappedDate, (deltaByDate.get(t.mappedDate) || 0) + delta)
    }
    let holding = 0
    return data.map((d) => {
      holding += deltaByDate.get(d.date) || 0
      return {
        time: d.time as any,
        value: holding > 0 ? 1 : 0,
        color: holding > 0 ? 'rgba(59,130,246,0.12)' : 'rgba(0,0,0,0)',
      }
    })
  }, [data, mappedTrades])

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError(null)

    fetch(
      `/api/stock/kline?symbol=${encodeURIComponent(symbol)}&market=${encodeURIComponent(market)}&range=${range}&interval=${interval}`,
      { cache: 'no-store' }
    )
      .then(async (res) => {
        const payload = await res.json()
        if (!res.ok) throw new Error(payload?.error || '获取K线失败')
        if (!mounted) return
        setData((payload?.candles || []) as KlineItem[])
        setSource(payload?.source || '')
      })
      .catch((e) => {
        if (!mounted) return
        setError(e instanceof Error ? e.message : '获取K线失败')
        setData([])
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [symbol, market, range, interval])

  useEffect(() => {
    if (!wrapRef.current) return

    const chart = createChart(wrapRef.current, {
      width: wrapRef.current.clientWidth,
      height: 360,
      layout: {
        background: { color: 'transparent' },
        textColor: '#8b95a7',
      },
      grid: {
        vertLines: { color: 'rgba(120,130,160,0.18)' },
        horzLines: { color: 'rgba(120,130,160,0.18)' },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: 'rgba(120,130,160,0.28)',
      },
      timeScale: {
        borderColor: 'rgba(120,130,160,0.28)',
      },
    })

    const candle = chart.addCandlestickSeries({
      upColor: '#ef4444',
      downColor: '#22c55e',
      borderVisible: false,
      wickUpColor: '#ef4444',
      wickDownColor: '#22c55e',
    })
    const volume = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      color: '#64748b',
    })
    const ma5 = chart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    })
    const ma10 = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    })
    const ma20 = chart.addLineSeries({
      color: '#a855f7',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    })
    const tradeLine = chart.addLineSeries({
      color: 'rgba(250,204,21,0.9)',
      lineWidth: 1,
      lineStyle: 2,
      pointMarkersVisible: true,
      pointMarkersRadius: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    })
    const holdingBand = chart.addHistogramSeries({
      priceScaleId: 'holding',
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
      base: 0,
    })

    chart.priceScale('').applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
    })
    chart.priceScale('holding').applyOptions({
      visible: false,
      autoScale: false,
      scaleMargins: { top: 0, bottom: 0 },
    })

    chartRef.current = chart
    candleRef.current = candle
    volumeRef.current = volume
    ma5Ref.current = ma5
    ma10Ref.current = ma10
    ma20Ref.current = ma20
    tradeLineRef.current = tradeLine
    holdingRef.current = holdingBand

    const onCrosshairMove = (param: MouseEventParams<any>) => {
      if (!param.time || !param.point) {
        setHover(null)
        return
      }
      const key = normalizeTimeKey(param.time)
      if (!key) {
        setHover(null)
        return
      }

      const candle = dataRef.current.find((d) => String(d.time) === key)
      const date = candle?.date || normalizeChartDate(param.time)
      if (!date) {
        setHover(null)
        return
      }
      const tradesAt = mappedTradesRef.current.filter((t) => t.mappedDate === date)
      setHover({
        x: param.point.x,
        y: param.point.y,
        date,
        candle,
        trades: tradesAt,
      })
    }

    chart.subscribeCrosshairMove(onCrosshairMove)

    const observer = new ResizeObserver(() => {
      if (!wrapRef.current || !chartRef.current) return
      chartRef.current.applyOptions({ width: wrapRef.current.clientWidth })
    })
    observer.observe(wrapRef.current)

    return () => {
      observer.disconnect()
      chart.unsubscribeCrosshairMove(onCrosshairMove)
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
      ma5Ref.current = null
      ma10Ref.current = null
      ma20Ref.current = null
      tradeLineRef.current = null
      holdingRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !ma5Ref.current || !ma10Ref.current || !ma20Ref.current || !tradeLineRef.current || !holdingRef.current) return

    dataRef.current = data
    mappedTradesRef.current = mappedTrades

    const candleData: CandlestickData<any>[] = data.map((d) => ({
      time: d.time as any,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }))
    const volumeData: HistogramData<any>[] = data.map((d) => ({
      time: d.time as any,
      value: d.volume,
      color: d.close >= d.open ? 'rgba(239,68,68,0.5)' : 'rgba(34,197,94,0.5)',
    }))

    candleRef.current.setData(candleData)
    volumeRef.current.setData(volumeData)
    ma5Ref.current.setData(ma5Data)
    ma10Ref.current.setData(ma10Data)
    ma20Ref.current.setData(ma20Data)
    tradeLineRef.current.setData(tradeLineData)
    holdingRef.current.setData(holdingData)
    candleRef.current.setMarkers(tradeMarkers)
    chartRef.current?.timeScale().fitContent()
  }, [data, mappedTrades, ma5Data, ma10Data, ma20Data, tradeLineData, holdingData, tradeMarkers])

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-foreground font-medium">K 线图</div>
        <div className="flex items-center gap-2 flex-wrap">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                range === r.value
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {INTERVALS.map((i) => {
            const disabled = !minuteSupported && i.value !== '1d'
            return (
              <button
                key={i.value}
                onClick={() => !disabled && setInterval(i.value)}
                disabled={disabled}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  interval === i.value
                    ? 'border-primary bg-primary/15 text-primary'
                    : disabled
                    ? 'border-border text-muted-foreground/40 cursor-not-allowed'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {i.label}
              </button>
            )
          })}
        </div>
      </div>

      {!minuteSupported && (
        <div className="mb-2 text-xs text-muted-foreground">当前市场暂仅支持日 K，分钟级将自动使用 1D。</div>
      )}

      <div className="relative">
        <div ref={wrapRef} className="h-[360px] w-full" />
        {hover && (
          <div
            className="pointer-events-none absolute z-10 min-w-48 rounded-md border border-border bg-card/95 px-3 py-2 text-xs shadow-lg"
            style={{
              left: Math.max(8, Math.min(hover.x + 12, (wrapRef.current?.clientWidth || 420) - 220)),
              top: Math.max(8, hover.y - 12),
            }}
          >
            <div className="font-medium text-foreground">{hover.date}</div>
            {hover.candle && (
              <div className="mt-1 text-muted-foreground font-mono">
                O {hover.candle.open.toFixed(2)} · H {hover.candle.high.toFixed(2)} · L {hover.candle.low.toFixed(2)} · C {hover.candle.close.toFixed(2)}
              </div>
            )}
            {hover.trades.length > 0 && (
              <div className="mt-2 space-y-1">
                {hover.trades.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2">
                    <span className={t.type === 'BUY' ? 'profit-text' : 'loss-text'}>
                      {t.type === 'BUY' ? '买入' : '卖出'} {t.quantity}
                    </span>
                    <span className="text-muted-foreground font-mono">
                      @{t.price} 费{(t.commission + t.tax).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#ef4444]" />买点</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#22c55e]" />卖点</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#f59e0b]" />MA5</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#3b82f6]" />MA10</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#a855f7]" />MA20</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#93c5fd]" />持仓区间</span>
        </div>
        <span>{loading ? '加载中...' : error ? error : `数据源: ${source || '-'} · 级别: ${interval.toUpperCase()}`}</span>
      </div>
    </div>
  )
}

function calcMA(data: KlineItem[], period: number): LineData<any>[] {
  if (!data.length) return []
  const result: LineData<any>[] = []
  const queue: number[] = []
  let sum = 0

  for (const d of data) {
    queue.push(d.close)
    sum += d.close
    if (queue.length > period) {
      sum -= queue.shift() || 0
    }
    if (queue.length === period) {
      result.push({ time: d.time as any, value: Number((sum / period).toFixed(4)) })
    }
  }
  return result
}

function normalizeTimeKey(time: any): string | null {
  if (!time) return null
  if (typeof time === 'number') return String(time)
  if (typeof time === 'string') return String(Date.parse(`${time}T00:00:00Z`) / 1000)
  if (typeof time === 'object' && 'year' in time && 'month' in time && 'day' in time) {
    const y = String(time.year).padStart(4, '0')
    const m = String(time.month).padStart(2, '0')
    const d = String(time.day).padStart(2, '0')
    return String(Date.parse(`${y}-${m}-${d}T00:00:00Z`) / 1000)
  }
  return null
}

function normalizeChartDate(time: any): string | null {
  if (!time) return null
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10)
  if (typeof time === 'string') return time.slice(0, 10)
  if (typeof time === 'object' && 'year' in time && 'month' in time && 'day' in time) {
    const y = String(time.year).padStart(4, '0')
    const m = String(time.month).padStart(2, '0')
    const d = String(time.day).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return null
}
