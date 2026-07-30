/**
 * Forward GlitchTip / Sentry webhooks to WeCom (企业微信) group messaging.
 *
 * Docs:
 * - WeCom: https://developer.work.weixin.qq.com/document/path/99110
 * - Inspired by: https://github.com/lly-ke/glichtip-webhook
 *
 * Point GlitchTip webhook URL to: http://<host>:3123/webhook
 */

const express = require('express')

const app = express()
const port = Number(process.env.PORT) || 3123

/** Full webhook URL, or build from GW_KEY */
const webhookUrl = resolveWebhookUrl()
/** Only forward these Environment values (comma-separated). Empty = all */
const onlyEnv = (process.env.GW_ONLY_ENV || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
/** markdown | news | text (default: markdown) */
const msgType = (process.env.GW_MSGTYPE || 'markdown').toLowerCase()
/** Optional @ mobiles for text messages; include @all to notify everyone */
const mentionedMobiles = (process.env.GW_MENTIONED_MOBILES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

app.use(express.json({ limit: '2mb' }))

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'wecom-glichtip-webhook',
    webhook: '/webhook',
    msgType,
    onlyEnv: onlyEnv.length ? onlyEnv : null,
  })
})

app.get('/health', (_req, res) => {
  res.status(200).send('ok')
})

app.post('/webhook', async (req, res) => {
  try {
    if (!webhookUrl) {
      console.error('[config] GW_WEBHOOK_URL or GW_KEY is required')
      return res.status(500).send('Missing GW_WEBHOOK_URL or GW_KEY')
    }

    const body = req.body || {}
    const attachments = Array.isArray(body.attachments) ? body.attachments : []
    const text = body.text || body.message || ''

    if (!attachments.length) {
      // Fallback when payload has no attachments
      await sendWeCom(buildFallbackPayload(text || JSON.stringify(body).slice(0, 500)))
      return res.status(200).send('Data received and processed')
    }

    for (const item of attachments) {
      await sendIssueToWeCom(item, text)
    }

    res.status(200).send('Data received and processed')
  } catch (error) {
    console.error('[webhook] failed to process request:', error)
    res.status(500).send('Server Error')
  }
})

app.listen(port, () => {
  console.log(`[listen] http://0.0.0.0:${port}`)
  console.log(`[config] msgType=${msgType}, onlyEnv=${onlyEnv.join(',') || '(all)'}`)
  if (!webhookUrl) {
    console.warn('[config] GW_WEBHOOK_URL / GW_KEY not set — incoming webhooks cannot be forwarded')
  }
})

function resolveWebhookUrl() {
  const full = (process.env.GW_WEBHOOK_URL || '').trim()
  if (full) return full
  const key = (process.env.GW_KEY || '').trim()
  if (!key) return ''
  return `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`
}

function getFieldValue(fields, title) {
  if (!Array.isArray(fields)) return undefined
  for (const field of fields) {
    if (field && field.title === title) return field.value
  }
  return undefined
}

async function sendIssueToWeCom(item, text) {
  const env = getFieldValue(item.fields, 'Environment')
  const project = getFieldValue(item.fields, 'Project')
  const culprits = getFieldValue(item.fields, 'Culprit') || getFieldValue(item.fields, 'culprit')

  if (onlyEnv.length) {
    if (!env || onlyEnv.indexOf(String(env)) === -1) {
      console.log(`[skip] environment not in GW_ONLY_ENV: ${env}`)
      return
    }
  }

  const title = item.title || 'GlitchTip Alert'
  const link = item.title_link || item.titleLink || ''
  const envLabel = env ? `环境: ${env}` : ''
  const projectLabel = project ? `项目: ${project}` : ''

  let payload
  if (msgType === 'news') {
    payload = {
      msgtype: 'news',
      news: {
        articles: [
          {
            title: truncate(`${envLabel ? `[${env}] ` : ''}${title}`, 128),
            description: truncate(
              [projectLabel, envLabel, text, culprits].filter(Boolean).join('\n'),
              512,
            ),
            url: link || 'https://work.weixin.qq.com/',
            picurl: process.env.GW_PIC_URL || '',
          },
        ],
      },
    }
  } else if (msgType === 'text') {
    const lines = [
      envLabel ? `[${envLabel}] ${title}` : title,
      projectLabel,
      culprits ? `位置: ${culprits}` : '',
      text,
      link ? `详情: ${link}` : '',
    ].filter(Boolean)
    payload = {
      msgtype: 'text',
      text: {
        content: truncate(lines.join('\n'), 2048),
        ...(mentionedMobiles.length
          ? { mentioned_mobile_list: mentionedMobiles }
          : {}),
      },
    }
  } else {
    // markdown — https://developer.work.weixin.qq.com/document/path/99110
    const color = env && /prod/i.test(String(env)) ? 'warning' : 'info'
    const content = [
      `## <font color="${color}">异常告警</font>`,
      envLabel ? `>环境:<font color="comment">${escapeMd(env)}</font>` : '',
      projectLabel ? `>项目:<font color="comment">${escapeMd(project)}</font>` : '',
      culprits ? `>位置:<font color="comment">${escapeMd(culprits)}</font>` : '',
      '',
      `**${escapeMd(title)}**`,
      text ? `\n${escapeMd(String(text).slice(0, 800))}` : '',
      link ? `\n[查看详情](${link})` : '',
    ]
      .filter((line) => line !== '')
      .join('\n')

    payload = {
      msgtype: 'markdown',
      markdown: {
        content: truncate(content, 4096),
      },
    }
  }

  await sendWeCom(payload)
}

function buildFallbackPayload(content) {
  if (msgType === 'text') {
    return {
      msgtype: 'text',
      text: {
        content: truncate(content, 2048),
        ...(mentionedMobiles.length
          ? { mentioned_mobile_list: mentionedMobiles }
          : {}),
      },
    }
  }
  return {
    msgtype: 'markdown',
    markdown: {
      content: truncate(`## 告警通知\n${escapeMd(content)}`, 4096),
    },
  }
}

async function sendWeCom(payload) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.errcode) {
    console.error('[wecom] send failed:', res.status, data)
    throw new Error(data.errmsg || `WeCom HTTP ${res.status}`)
  }
  console.log('[wecom] sent:', data)
  return data
}

function escapeMd(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function truncate(s, maxBytes) {
  const str = String(s ?? '')
  const buf = Buffer.from(str, 'utf8')
  if (buf.length <= maxBytes) return str
  return buf.subarray(0, maxBytes - 3).toString('utf8').replace(/\uFFFD$/, '') + '...'
}
