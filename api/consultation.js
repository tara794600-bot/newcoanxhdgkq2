import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { google } from 'googleapis'
import { createDecipheriv, createHash } from 'node:crypto'

const LIMITS = {
  name: 60,
  phone: 40,
  details: 4000,
  yesNo: 10,
  clientIp: 120,
  source: 80,
  pagePath: 300,
  landingPath: 300,
  landingToken: 600,
  landingKeyword: 120,
  queryString: 800,
  referrer: 800,
  visitSource: 20,
  userAgent: 500,
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const toTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '')

const formatYesNoForDisplay = (value) => {
  if (value === 'yes') {
    return '예'
  }

  if (value === 'no') {
    return '아니요'
  }

  return '-'
}

const normalizeVisitSource = (value) => {
  const normalized = toTrimmedString(value).toLowerCase()

  if (normalized === 'naver' || normalized === '네이버') {
    return 'naver'
  }

  if (normalized === 'google' || normalized === '구글') {
    return 'google'
  }

  return ''
}

const detectVisitSource = ({ visitSource, source, landingToken, queryString, referrer, userAgent }) => {
  const explicitVisitSource = normalizeVisitSource(visitSource)
  const normalizedSource = toTrimmedString(source).toLowerCase()
  const normalizedLandingToken = toTrimmedString(landingToken)
  const normalizedQueryString = toTrimmedString(queryString).toLowerCase()
  const normalizedReferrer = toTrimmedString(referrer).toLowerCase()
  const normalizedUserAgent = toTrimmedString(userAgent).toLowerCase()

  const hasNaverSignal =
    Boolean(normalizedLandingToken) ||
    normalizedSource.includes('naver') ||
    normalizedUserAgent.includes('naver') ||
    normalizedUserAgent.includes('whale') ||
    normalizedReferrer.includes('naver.') ||
    normalizedQueryString.includes('utm_source=naver') ||
    normalizedQueryString.includes('n_keyword') ||
    normalizedQueryString.includes('n_query') ||
    normalizedQueryString.includes('n_campaign')

  if (hasNaverSignal) {
    return 'naver'
  }

  const hasGoogleSignal =
    normalizedSource.includes('google') ||
    normalizedReferrer.includes('google.') ||
    normalizedReferrer.includes('doubleclick.net') ||
    normalizedQueryString.includes('utm_source=google') ||
    normalizedQueryString.includes('gclid') ||
    normalizedQueryString.includes('gbraid') ||
    normalizedQueryString.includes('wbraid')

  if (hasGoogleSignal) {
    return 'google'
  }

  if (explicitVisitSource) {
    return explicitVisitSource
  }

  return ''
}

const formatVisitSourceForDisplay = (visitSource) => {
  const normalizedVisitSource = normalizeVisitSource(visitSource)

  if (normalizedVisitSource === 'naver') {
    return '네이버'
  }

  if (normalizedVisitSource === 'google') {
    return '구글'
  }

  return ''
}

const toHeaderCandidates = (value) => {
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      typeof item === 'string'
        ? item.split(',').map((part) => part.trim())
        : [],
    )
  }

  if (typeof value === 'string') {
    return value.split(',').map((part) => part.trim())
  }

  return []
}

const normalizeClientIp = (value) => {
  const trimmed = toTrimmedString(value)

  if (!trimmed) {
    return ''
  }

  const bracketMatch = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/)
  const candidate = bracketMatch ? bracketMatch[1] : trimmed
  const withoutIpv4Port = candidate.replace(
    /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/,
    '$1',
  )

  if (withoutIpv4Port.startsWith('::ffff:')) {
    return withoutIpv4Port.slice(7)
  }

  return withoutIpv4Port
}

const getClientIp = (req) => {
  const headerOrder = [
    req.headers['x-forwarded-for'],
    req.headers['x-real-ip'],
    req.headers['x-vercel-forwarded-for'],
    req.headers['cf-connecting-ip'],
    req.headers['x-client-ip'],
  ]

  for (const rawHeader of headerOrder) {
    const candidates = toHeaderCandidates(rawHeader)

    for (const candidate of candidates) {
      const normalizedIp = normalizeClientIp(candidate)

      if (normalizedIp) {
        return normalizedIp.slice(0, LIMITS.clientIp)
      }
    }
  }

  const remoteAddress =
    normalizeClientIp(req.socket?.remoteAddress) ||
    normalizeClientIp(req.connection?.remoteAddress)

  return remoteAddress ? remoteAddress.slice(0, LIMITS.clientIp) : ''
}

const parseJsonEnv = (key) => {
  const rawValue = process.env[key]

  if (!rawValue || !rawValue.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue)

    if (parsed && typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
    }

    return parsed
  } catch (error) {
    throw new Error(`${key} 환경변수가 JSON 형식이 아닙니다.`)
  }
}

const getFirebaseApp = () => {
  if (getApps().length > 0) {
    return getApps()[0]
  }

  const serviceAccount =
    parseJsonEnv('FIREBASE_SERVICE_ACCOUNT_JSON') ??
    parseJsonEnv('GOOGLE_SERVICE_ACCOUNT_JSON')

  if (!serviceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 환경변수를 설정해주세요.')
  }

  return initializeApp({
    credential: cert(serviceAccount),
  })
}

const decodePowerlinkKeyword = (token) => {
  const normalizedToken = toTrimmedString(token)
  const secret = toTrimmedString(process.env.POWERLINK_URL_SECRET)

  if (!normalizedToken || !secret) {
    return ''
  }

  try {
    const payloadBuffer = Buffer.from(normalizedToken, 'base64url')

    if (payloadBuffer.length <= 28) {
      return ''
    }

    const iv = payloadBuffer.subarray(0, 12)
    const authTag = payloadBuffer.subarray(12, 28)
    const encrypted = payloadBuffer.subarray(28)
    const key = createHash('sha256').update(secret).digest()
    const decipher = createDecipheriv('aes-256-gcm', key, iv)

    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8').trim()
    return decrypted.slice(0, LIMITS.landingKeyword)
  } catch {
    return ''
  }
}

const NAVER_TRACKING_KEYWORD_PARAMS = [
  'n_keyword',
  'n_query',
  'keyword',
  'query',
  'utm_term',
  'utm_keyword',
  'search_keyword',
  'searchKeyword',
]

const normalizeTrackedNaverKeyword = (value) =>
  toTrimmedString(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, LIMITS.landingKeyword)

const isUsableTrackedKeyword = (value) => {
  const normalizedValue = toTrimmedString(value)
  return Boolean(normalizedValue) && !/^\{[^{}]+\}$/.test(normalizedValue)
}

const getNaverTrackedKeywordFromQueryString = (queryString) => {
  const normalizedQueryString = toTrimmedString(queryString).replace(/^\?/, '')

  if (!normalizedQueryString) {
    return ''
  }

  try {
    const params = new URLSearchParams(normalizedQueryString)

    for (const paramName of NAVER_TRACKING_KEYWORD_PARAMS) {
      const keyword = normalizeTrackedNaverKeyword(params.get(paramName))

      if (isUsableTrackedKeyword(keyword)) {
        return keyword
      }
    }

    const lowerParamNames = NAVER_TRACKING_KEYWORD_PARAMS.map((paramName) => paramName.toLowerCase())

    for (const [paramName, value] of params.entries()) {
      if (!lowerParamNames.includes(paramName.toLowerCase())) {
        continue
      }

      const keyword = normalizeTrackedNaverKeyword(value)

      if (isUsableTrackedKeyword(keyword)) {
        return keyword
      }
    }
  } catch {
    return ''
  }

  return ''
}

const validateConsultationPayload = (payload) => {
  const name = toTrimmedString(payload.name)
  const phone = toTrimmedString(payload.phone)
  const details = toTrimmedString(payload.details)
  const incidentAfter2025 = toTrimmedString(payload.incidentAfter2025).slice(0, LIMITS.yesNo)
  const source = toTrimmedString(payload.source) || 'website-quick-form'
  const pagePath = toTrimmedString(payload.pagePath) || '#/'
  const landingPath = toTrimmedString(payload.landingPath) || '/'
  const landingToken = toTrimmedString(payload.landingToken)
  const queryString = toTrimmedString(payload.queryString)
  const referrer = toTrimmedString(payload.referrer)
  const rawVisitSource = toTrimmedString(payload.visitSource)
  const userAgent = toTrimmedString(payload.userAgent)
  const trackedNaverKeyword = getNaverTrackedKeywordFromQueryString(queryString)
  const landingKeyword = decodePowerlinkKeyword(landingToken) || trackedNaverKeyword
  const resolvedSource =
    source === 'website-quick-form' && (landingToken || trackedNaverKeyword)
      ? 'naver-powerlink'
      : source
  const visitSource = detectVisitSource({
    visitSource: rawVisitSource,
    source: resolvedSource,
    landingToken,
    queryString,
    referrer,
    userAgent,
  })

  if (!name || !phone || !details) {
    throw new HttpError(400, '이름, 연락처, 피해 내용을 모두 입력해주세요.')
  }

  if (incidentAfter2025 !== 'yes') {
    throw new HttpError(400, '2025년 이후 사건만 신청할 수 있습니다.')
  }

  if (name.length > LIMITS.name) {
    throw new HttpError(400, `이름은 ${LIMITS.name}자 이하로 입력해주세요.`)
  }

  if (phone.length > LIMITS.phone) {
    throw new HttpError(400, `연락처는 ${LIMITS.phone}자 이하로 입력해주세요.`)
  }

  if (details.length > LIMITS.details) {
    throw new HttpError(400, `피해 내용은 ${LIMITS.details}자 이하로 입력해주세요.`)
  }

  if (resolvedSource.length > LIMITS.source) {
    throw new HttpError(400, '접수 출처(source) 길이가 너무 깁니다.')
  }

  if (pagePath.length > LIMITS.pagePath) {
    throw new HttpError(400, '경로(pagePath) 길이가 너무 깁니다.')
  }

  if (landingPath.length > LIMITS.landingPath) {
    throw new HttpError(400, '랜딩 경로(landingPath) 길이가 너무 깁니다.')
  }

  if (landingToken.length > LIMITS.landingToken) {
    throw new HttpError(400, '랜딩 토큰(landingToken) 길이가 너무 깁니다.')
  }

  if (queryString.length > LIMITS.queryString) {
    throw new HttpError(400, '쿼리 문자열(queryString) 길이가 너무 깁니다.')
  }

  if (referrer.length > LIMITS.referrer) {
    throw new HttpError(400, '이전 경로(referrer) 길이가 너무 깁니다.')
  }

  if (rawVisitSource.length > LIMITS.visitSource) {
    throw new HttpError(400, '접속 출처(visitSource) 길이가 너무 깁니다.')
  }

  if (userAgent.length > LIMITS.userAgent) {
    throw new HttpError(400, '사용자 정보(userAgent) 길이가 너무 깁니다.')
  }

  return {
    name,
    phone,
    details,
    incidentAfter2025,
    source: resolvedSource,
    pagePath,
    landingPath,
    landingToken,
    landingKeyword,
    queryString,
    referrer,
    visitSource,
    userAgent,
  }
}

const validateIneligibleIncidentBlockPayload = (payload) => {
  const incidentAfter2025 = toTrimmedString(payload.incidentAfter2025).slice(0, LIMITS.yesNo)
  const source = toTrimmedString(payload.source) || 'website-quick-form'
  const pagePath = toTrimmedString(payload.pagePath) || '#/'
  const landingPath = toTrimmedString(payload.landingPath) || '/'
  const landingToken = toTrimmedString(payload.landingToken)
  const queryString = toTrimmedString(payload.queryString)
  const referrer = toTrimmedString(payload.referrer)
  const rawVisitSource = toTrimmedString(payload.visitSource)
  const userAgent = toTrimmedString(payload.userAgent)
  const trackedNaverKeyword = getNaverTrackedKeywordFromQueryString(queryString)
  const landingKeyword = decodePowerlinkKeyword(landingToken) || trackedNaverKeyword
  const resolvedSource =
    source === 'website-quick-form' && (landingToken || trackedNaverKeyword)
      ? 'naver-powerlink'
      : source
  const visitSource = detectVisitSource({
    visitSource: rawVisitSource,
    source: resolvedSource,
    landingToken,
    queryString,
    referrer,
    userAgent,
  })

  if (incidentAfter2025 !== 'no') {
    throw new HttpError(400, '차단 대상이 아닙니다.')
  }

  if (resolvedSource.length > LIMITS.source) {
    throw new HttpError(400, '접수 출처(source) 길이가 너무 깁니다.')
  }

  if (pagePath.length > LIMITS.pagePath) {
    throw new HttpError(400, '경로(pagePath) 길이가 너무 깁니다.')
  }

  if (landingPath.length > LIMITS.landingPath) {
    throw new HttpError(400, '랜딩 경로(landingPath) 길이가 너무 깁니다.')
  }

  if (landingToken.length > LIMITS.landingToken) {
    throw new HttpError(400, '랜딩 토큰(landingToken) 길이가 너무 깁니다.')
  }

  if (queryString.length > LIMITS.queryString) {
    throw new HttpError(400, '쿼리 문자열(queryString) 길이가 너무 깁니다.')
  }

  if (referrer.length > LIMITS.referrer) {
    throw new HttpError(400, '이전 경로(referrer) 길이가 너무 깁니다.')
  }

  if (rawVisitSource.length > LIMITS.visitSource) {
    throw new HttpError(400, '접속 출처(visitSource) 길이가 너무 깁니다.')
  }

  if (userAgent.length > LIMITS.userAgent) {
    throw new HttpError(400, '사용자 정보(userAgent) 길이가 너무 깁니다.')
  }

  return {
    incidentAfter2025,
    source: resolvedSource,
    pagePath,
    landingPath,
    landingToken,
    landingKeyword,
    queryString,
    referrer,
    visitSource,
    userAgent,
  }
}

const formatPhoneForDisplay = (phone) => {
  const digits = toTrimmedString(phone).replace(/[^0-9]/g, '')

  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  }

  if (digits.length === 10 && digits.startsWith('02')) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`
  }

  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  }

  return toTrimmedString(phone)
}

const buildTelegramMessage = (request) => {
  const formattedPhone = formatPhoneForDisplay(request.phone)
  const details = toTrimmedString(request.details)
  const landingKeyword = toTrimmedString(request.landingKeyword)
  const visitSourceLabel = formatVisitSourceForDisplay(
    detectVisitSource({
      visitSource: request.visitSource,
      source: request.source,
      landingToken: request.landingToken,
      queryString: request.queryString,
      referrer: request.referrer,
      userAgent: request.userAgent,
    }),
  )

  return [
    ...(visitSourceLabel ? [visitSourceLabel, ''] : []),
    '📩 새로운 신청',
    '',
    `👤 이름: ${request.name}`,
    `📞 연락처: ${formattedPhone}`,
    `🗓️ 25년 이후 사건: ${formatYesNoForDisplay(request.incidentAfter2025)}`,
    ...(landingKeyword ? [`🔎 검색어: ${landingKeyword}`] : []),
    `✅ 피해내용: ${details}`,
  ].join('\n')
}

const toErrorMessage = (error) => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return '알 수 없는 오류가 발생했습니다.'
}

const sendTelegramAlert = async (request) => {
  const botToken = toTrimmedString(process.env.TELEGRAM_BOT_TOKEN)
  const chatId = toTrimmedString(process.env.TELEGRAM_CHAT_ID)

  if (!botToken || !chatId) {
    return {
      success: false,
      skipped: true,
      message: 'TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID가 없어 전송을 건너뜁니다.',
    }
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: buildTelegramMessage(request),
      disable_web_page_preview: true,
    }),
  })

  if (!response.ok) {
    const responseText = await response.text()
    throw new Error(`텔레그램 전송 실패: ${response.status} ${responseText}`)
  }

  return {
    success: true,
    skipped: false,
    message: '텔레그램 전송 완료',
  }
}

const appendGoogleSheet = async (request) => {
  const spreadsheetId = toTrimmedString(process.env.GOOGLE_SHEET_ID)
  const sheetName = toTrimmedString(process.env.GOOGLE_SHEET_NAME) || 'Sheet1'
  const serviceAccount = parseJsonEnv('GOOGLE_SERVICE_ACCOUNT_JSON')

  if (!spreadsheetId || !serviceAccount) {
    return {
      success: false,
      skipped: true,
      message: 'GOOGLE_SHEET_ID 또는 GOOGLE_SERVICE_ACCOUNT_JSON이 없어 전송을 건너뜁니다.',
    }
  }

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  const sheets = google.sheets({
    version: 'v4',
    auth,
  })

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:E`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [
        [
          request.name,
          formatPhoneForDisplay(request.phone),
          formatYesNoForDisplay(request.incidentAfter2025),
          request.details,
          toTrimmedString(request.landingKeyword),
        ],
      ],
    },
  })

  return {
    success: true,
    skipped: false,
    message: 'Google Sheets 전송 완료',
  }
}

const toRequestBody = (requestBody) => {
  if (!requestBody) {
    return {}
  }

  if (typeof requestBody === 'string') {
    try {
      return JSON.parse(requestBody)
    } catch (error) {
      throw new HttpError(400, '요청 본문(JSON) 형식이 올바르지 않습니다.')
    }
  }

  if (typeof requestBody !== 'object') {
    throw new HttpError(400, '요청 본문 형식이 올바르지 않습니다.')
  }

  return requestBody
}

export default async function handler(req, res) {
  const allowedOrigin = toTrimmedString(process.env.CORS_ALLOW_ORIGIN) || '*'
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      message: 'POST 요청만 허용됩니다.',
    })
  }

  try {
    const app = getFirebaseApp()
    const db = getFirestore(app)
    const body = toRequestBody(req.body)
    const action = toTrimmedString(body.action)

    if (action === 'block-ineligible-incident') {
      const payload = validateIneligibleIncidentBlockPayload(body)
      const clientIp = getClientIp(req)
      const createdAt = new Date()

      if (!clientIp) {
        throw new HttpError(400, '클라이언트 IP를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.')
      }

      const clientIpHash = createHash('sha256').update(clientIp).digest('hex')
      const blockRef = db.collection('consultationIpBlocks').doc(clientIpHash)
      let blocked = false

      await db.runTransaction(async (transaction) => {
        const blockSnapshot = await transaction.get(blockRef)

        if (blockSnapshot.exists) {
          return
        }

        blocked = true
        transaction.set(blockRef, {
          blocked: true,
          blockedAt: FieldValue.serverTimestamp(),
          firstCreatedAtClient: createdAt.toISOString(),
          source: payload.source,
          reason: 'ineligible-incident-before-2025',
          incidentAfter2025: payload.incidentAfter2025,
          pagePath: payload.pagePath,
          landingPath: payload.landingPath,
          landingToken: payload.landingToken,
          landingKeyword: payload.landingKeyword,
          queryString: payload.queryString,
          referrer: payload.referrer,
          visitSource: payload.visitSource,
          userAgent: payload.userAgent,
        })
      })

      return res.status(200).json({
        ok: true,
        blocked,
      })
    }

    const payload = validateConsultationPayload(body)
    const clientIp = getClientIp(req)
    const createdAt = new Date()
    const createdAtKst = createdAt.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour12: false,
    })
    const requestCollection = db.collection('consultationRequests')

    if (!clientIp) {
      throw new HttpError(400, '클라이언트 IP를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.')
    }

    const clientIpHash = createHash('sha256').update(clientIp).digest('hex')
    const blockRef = db.collection('consultationIpBlocks').doc(clientIpHash)
    const docRef = requestCollection.doc()

    await db.runTransaction(async (transaction) => {
      const blockSnapshot = await transaction.get(blockRef)

      if (blockSnapshot.exists) {
        throw new HttpError(429, '이미 접수된 IP입니다. 다른 네트워크에서 다시 시도해주세요.')
      }

      transaction.set(docRef, {
        name: payload.name,
        phone: payload.phone,
        details: payload.details,
        incidentAfter2025: payload.incidentAfter2025,
        source: payload.source,
        pagePath: payload.pagePath,
        landingPath: payload.landingPath,
        landingToken: payload.landingToken,
        landingKeyword: payload.landingKeyword,
        queryString: payload.queryString,
        referrer: payload.referrer,
        visitSource: payload.visitSource,
        userAgent: payload.userAgent,
        clientIpHash,
        createdAt: FieldValue.serverTimestamp(),
        createdAtClient: createdAt.toISOString(),
        status: 'received',
      })

      transaction.set(blockRef, {
        blocked: true,
        blockedAt: FieldValue.serverTimestamp(),
        firstRequestId: docRef.id,
        firstCreatedAtClient: createdAt.toISOString(),
        source: payload.source,
        visitSource: payload.visitSource,
      })
    })

    const request = {
      ...payload,
      requestId: docRef.id,
      createdAtKst,
    }

    const [sheetOutcome, telegramOutcome] = await Promise.allSettled([
      appendGoogleSheet(request),
      sendTelegramAlert(request),
    ])

    const sheetResult =
      sheetOutcome.status === 'fulfilled'
        ? sheetOutcome.value
        : {
            success: false,
            skipped: false,
            message: toErrorMessage(sheetOutcome.reason),
          }

    const telegramResult =
      telegramOutcome.status === 'fulfilled'
        ? telegramOutcome.value
        : {
            success: false,
            skipped: false,
            message: toErrorMessage(telegramOutcome.reason),
          }

    await docRef.set(
      {
        delivery: {
          googleSheets: sheetResult,
          telegram: telegramResult,
          syncedAt: FieldValue.serverTimestamp(),
          allSucceeded: sheetResult.success && telegramResult.success,
        },
      },
      { merge: true },
    )

    return res.status(200).json({
      ok: true,
      id: docRef.id,
      forwarded: {
        googleSheets: sheetResult.success,
        telegram: telegramResult.success,
      },
    })
  } catch (error) {
    console.error('[api/consultation] error', error)

    if (error instanceof HttpError) {
      return res.status(error.status).json({
        ok: false,
        message: error.message,
      })
    }

    return res.status(500).json({
      ok: false,
      message: '상담 접수 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    })
  }
}
