// Vercel Serverless Function (Node 18+)
// URL: /api/youtube?channel=@TodayDio
// Env: YOUTUBE_API_KEY

function json(res, status, body, cacheSeconds = 21600) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", `public, s-maxage=${cacheSeconds}, stale-while-revalidate=60`);
  res.end(JSON.stringify(body));
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const t = await r.text();
  let data = {};
  try { data = JSON.parse(t); } catch {}
  return { ok: r.ok, status: r.status, statusText: r.statusText, data };
}

async function resolveChannelId({ apiKey, channel }) {
  const raw = channel.trim();
  const handleWithAt = raw.startsWith("@") ? raw : `@${raw}`;
  const handleNoAt = raw.startsWith("@") ? raw.slice(1) : raw;

  if (raw.startsWith("UC") && raw.length > 10) return raw;

  // 1) forHandle은 @ 포함/미포함 둘 다 시도
  for (const h of [handleNoAt, handleWithAt]) {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(h)}&key=${encodeURIComponent(apiKey)}`;
    const r = await fetchJson(url);
    const id = r?.data?.items?.[0]?.id;
    if (r.ok && id) return id;
  }

  // 2) search.list에서 q에 @handle도 같이 시도
  for (const q of [handleWithAt, handleNoAt]) {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(q)}&key=${encodeURIComponent(apiKey)}`;
    const r = await fetchJson(url);

    // 검색 자체가 막히면(쿼터/키 제한/비활성화) 여기서 확인 가능
    if (!r.ok && r?.data?.error?.message) {
      throw new Error(`YouTube search error: ${r.data.error.message}`);
    }

    const id = r?.data?.items?.[0]?.snippet?.channelId;
    if (r.ok && id) return id;
  }

  return "";
}

module.exports = async (req, res) => {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return json(res, 500, { ok: false, error: "Missing YOUTUBE_API_KEY on server." });

  const url = new URL(req.url, "https://example.com");
  const channel = (url.searchParams.get("channel") || "").trim();
  if (!channel) return json(res, 400, { ok: false, error: "Missing ?channel=" });

  const refresh = Number(url.searchParams.get("refresh") || "21600");
  const cacheSeconds = Number.isFinite(refresh) && refresh >= 60 ? Math.min(refresh, 86400) : 21600;

  try {
    const channelId = await resolveChannelId({ apiKey, channel });
    if (!channelId) return json(res, 404, { ok: false, error: "채널을 찾지 못했어요. @핸들 철자/대소문자 확인하거나 채널ID(UC...)로 넣어주세요." }, cacheSeconds);

    const statsUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`;
    const r = await fetchJson(statsUrl);

    if (!r.ok) {
      const msg = r?.data?.error?.message || r.statusText || "YouTube API error";
      return json(res, 502, { ok: false, error: msg }, cacheSeconds);
    }

    const item = r?.data?.items?.[0];
    const sub = item?.statistics?.subscriberCount;
    if (sub == null) return json(res, 404, { ok: false, error: "Subscriber count not available." }, cacheSeconds);

    return json(res, 200, {
      ok: true,
      channel,
      channelId,
      subscriberCount: Number(sub),
      fetchedAt: new Date().toISOString(),
    }, cacheSeconds);

  } catch (e) {
    return json(res, 500, { ok: false, error: e?.message || "Server error" }, cacheSeconds);
  }
};
