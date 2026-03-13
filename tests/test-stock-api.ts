// 测试腾讯财经 API
async function testTencentAPI() {
  console.log('=== 测试腾讯财经 API ===\n')

  const testCodes = [
    { code: '510300', market: 'A', desc: '沪深300ETF (上交所)' },
    { code: '000001', market: 'A', desc: '平安银行 (深交所)' },
    { code: '600519', market: 'A', desc: '贵州茅台 (上交所)' },
  ]

  for (const { code, market, desc } of testCodes) {
    console.log(`\n测试: ${desc}`)
    console.log(`代码: ${code}, 市场: ${market}`)

    // 确定腾讯代码
    let tencentCode = ''
    if (market === 'A' || market === 'FUND') {
      const c = code.trim()
      if (c.startsWith('6') || c.startsWith('5')) {
        tencentCode = `sh${c}`
      } else {
        tencentCode = `sz${c}`
      }
    }

    console.log(`腾讯代码: ${tencentCode}`)

    try {
      const url = `https://qt.gtimg.cn/q=${tencentCode}&r=${Date.now()}`
      console.log(`请求 URL: ${url}`)

      const res = await fetch(url, {
        headers: { Referer: 'https://finance.qq.com' },
      })

      if (!res.ok) {
        console.log(`❌ 请求失败: ${res.status} ${res.statusText}`)
        continue
      }

      const text = await res.text()
      console.log(`原始响应: ${text}`)

      // 解析
      const match = text.match(/="([^"]+)"/)
      if (!match) {
        console.log('❌ 解析失败: 无法匹配数据格式')
        continue
      }

      const parts = match[1].split('~')
      console.log(`解析后的 parts 数量: ${parts.length}`)
      console.log(`前10个字段:`, JSON.stringify(parts.slice(0, 10), null, 2))

      if (parts.length < 50) {
        console.log('❌ 字段数量不足 (至少需要50个)')
        continue
      }

      // 检查第一个字段
      console.log(`第一个字段 (有效标志): "${parts[0]}"`)
      if (parts[0] === '' || parts[0] === '-') {
        console.log('❌ 股票不存在或已退市')
        continue
      }

      // 提取关键数据
      const name = parts[1] || code
      const price = parseFloat(parts[3])
      const prevClose = parseFloat(parts[4])

      console.log(`名称: ${name}`)
      console.log(`现价: ${price}`)
      console.log(`昨收: ${prevClose}`)

      if (isNaN(price) || price <= 0) {
        console.log('❌ 价格无效')
        continue
      }

      console.log('✅ 解析成功!')
    } catch (e) {
      console.log(`❌ 请求异常:`, e)
    }
  }
}

// 运行测试
testTencentAPI().catch(console.error)
