const SITE_SESSION_KEY = "mercurymetrics_site_session_id_v1";
const JOURNEY_ID_KEY = "mercurymetrics_journey_id_v1";
const ATTRIBUTION_KEY = "mercurymetrics_first_touch_v1";
const SESSION_POSTED_KEY = "mercurymetrics_site_session_posted_v1";
const ENTRY_SURFACE = "mercury_metrics_main_site";
const TELEMETRY_ORIGIN = "https://archetype.mercury-metrics.ch";
const SITE_SESSION_ENDPOINT = `${TELEMETRY_ORIGIN}/api/site/session`;
const SITE_EVENT_ENDPOINT = `${TELEMETRY_ORIGIN}/api/site/event`;

export function createSiteTelemetryController({
  windowLike = globalThis.window,
  documentLike = globalThis.document,
  navigatorLike = globalThis.navigator,
  sessionStorageLike = globalThis.sessionStorage,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  telemetryOrigin = TELEMETRY_ORIGIN,
  onError = () => {}
} = {}) {
  const siteSessionEndpoint = `${telemetryOrigin}/api/site/session`;
  const siteEventEndpoint = `${telemetryOrigin}/api/site/event`;

  function readSessionStorage(key) {
    try {
      return sessionStorageLike?.getItem?.(key) ?? null;
    } catch {
      return null;
    }
  }

  function writeSessionStorage(key, value) {
    try {
      sessionStorageLike?.setItem?.(key, value);
    } catch {
      // Ignore storage failures to keep the site functional.
    }
  }

  function getOrCreateId(key) {
    const existing = readSessionStorage(key);
    if (existing) {
      return existing;
    }
    const created = crypto.randomUUID();
    writeSessionStorage(key, created);
    return created;
  }

  function cleanText(value) {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 2048) : null;
  }

  function sanitizePath(pathname) {
    const normalized = cleanText(pathname);
    if (!normalized) {
      return "/";
    }
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }

  function buildFirstTouchAttribution() {
    const location = windowLike?.location;
    const params = new URLSearchParams(location?.search || "");
    return {
      landing_url: cleanText(location?.href || ""),
      path: sanitizePath(location?.pathname || "/"),
      referrer: cleanText(documentLike?.referrer || ""),
      utm_source: cleanText(params.get("utm_source")),
      utm_medium: cleanText(params.get("utm_medium")),
      utm_campaign: cleanText(params.get("utm_campaign")),
      utm_content: cleanText(params.get("utm_content")),
      utm_term: cleanText(params.get("utm_term"))
    };
  }

  function getFirstTouchAttribution() {
    const stored = readSessionStorage(ATTRIBUTION_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Fall through to rebuild.
      }
    }
    const attribution = buildFirstTouchAttribution();
    writeSessionStorage(ATTRIBUTION_KEY, JSON.stringify(attribution));
    return attribution;
  }

  function buildSiteSessionPayload() {
    const attribution = getFirstTouchAttribution();
    return {
      site_session_id: getOrCreateSiteSessionId(),
      journey_id: getOrCreateJourneyId(),
      created_at: now(),
      landing_url: attribution.landing_url,
      path: attribution.path,
      referrer: attribution.referrer,
      utm_source: attribution.utm_source,
      utm_medium: attribution.utm_medium,
      utm_campaign: attribution.utm_campaign,
      utm_content: attribution.utm_content,
      utm_term: attribution.utm_term
    };
  }

  function postJson(url, payload, { keepalive = false } = {}) {
    if (typeof fetchImpl !== "function") {
      return Promise.resolve(false);
    }
    return fetchImpl(url, {
      method: "POST",
      mode: "cors",
      keepalive,
      headers: {
        "content-type": "text/plain;charset=UTF-8"
      },
      body: JSON.stringify(payload)
    })
      .then((response) => response.ok)
      .catch((error) => {
        onError(error);
        return false;
      });
  }

  function beaconJson(url, payload) {
    try {
      if (typeof navigatorLike?.sendBeacon !== "function") {
        return false;
      }
      const body = new Blob([JSON.stringify(payload)], {
        type: "text/plain;charset=UTF-8"
      });
      return navigatorLike.sendBeacon(url, body);
    } catch (error) {
      onError(error);
      return false;
    }
  }

  function getOrCreateSiteSessionId() {
    return getOrCreateId(SITE_SESSION_KEY);
  }

  function getOrCreateJourneyId() {
    return getOrCreateId(JOURNEY_ID_KEY);
  }

  async function ensureSiteSession() {
    if (readSessionStorage(SESSION_POSTED_KEY) === "1") {
      return true;
    }
    const ok = await postJson(siteSessionEndpoint, buildSiteSessionPayload(), { keepalive: true });
    if (ok) {
      writeSessionStorage(SESSION_POSTED_KEY, "1");
    }
    return ok;
  }

  function buildArchetypeUrl(placement, baseHref = `${TELEMETRY_ORIGIN}/`) {
    const url = new URL(baseHref, windowLike?.location?.href || `${TELEMETRY_ORIGIN}/`);
    const attribution = getFirstTouchAttribution();

    url.search = "";
    url.hash = "";

    if (attribution.utm_source) url.searchParams.set("utm_source", attribution.utm_source);
    if (attribution.utm_medium) url.searchParams.set("utm_medium", attribution.utm_medium);
    if (attribution.utm_campaign) url.searchParams.set("utm_campaign", attribution.utm_campaign);
    if (attribution.utm_content) url.searchParams.set("utm_content", attribution.utm_content);
    if (attribution.utm_term) url.searchParams.set("utm_term", attribution.utm_term);

    url.searchParams.set("mm_journey_id", getOrCreateJourneyId());
    url.searchParams.set("mm_entry_surface", ENTRY_SURFACE);
    url.searchParams.set("mm_entry_cta", placement);

    if (attribution.utm_source) url.searchParams.set("mm_first_touch_source", attribution.utm_source);
    if (attribution.utm_medium) url.searchParams.set("mm_first_touch_medium", attribution.utm_medium);
    if (attribution.utm_campaign) url.searchParams.set("mm_first_touch_campaign", attribution.utm_campaign);
    if (attribution.utm_content) url.searchParams.set("mm_first_touch_content", attribution.utm_content);
    if (attribution.utm_term) url.searchParams.set("mm_first_touch_term", attribution.utm_term);
    if (attribution.referrer) url.searchParams.set("mm_first_touch_referrer", attribution.referrer);
    if (attribution.landing_url) url.searchParams.set("mm_first_touch_landing_url", attribution.landing_url);

    return url.toString();
  }

  function trackArchetypeCtaClick(placement) {
    const payload = {
      site_session_id: getOrCreateSiteSessionId(),
      journey_id: getOrCreateJourneyId(),
      event_name: "archetype_cta_click",
      created_at: now(),
      properties: {
        placement
      },
      session_context: buildSiteSessionPayload()
    };

    if (beaconJson(siteEventEndpoint, payload)) {
      return;
    }

    void postJson(siteEventEndpoint, payload, { keepalive: true });
  }

  function instrumentCtas() {
    const ctas = [...documentLike?.querySelectorAll?.("[data-archetype-placement]") || []];
    for (const cta of ctas) {
      const placement = cleanText(cta.getAttribute("data-archetype-placement"));
      if (!placement) {
        continue;
      }
      const originalHref = cta.getAttribute("href") || `${TELEMETRY_ORIGIN}/`;
      cta.setAttribute("href", buildArchetypeUrl(placement, originalHref));
      cta.addEventListener("click", () => {
        try {
          cta.setAttribute("href", buildArchetypeUrl(placement, originalHref));
          trackArchetypeCtaClick(placement);
        } catch (error) {
          onError(error);
        }
      });
    }
    return ctas.length;
  }

  return {
    buildArchetypeUrl,
    buildSiteSessionPayload,
    ensureSiteSession,
    getFirstTouchAttribution,
    getOrCreateJourneyId,
    getOrCreateSiteSessionId,
    instrumentCtas,
    trackArchetypeCtaClick
  };
}

export function initMercuryMetricsSiteTelemetry(options = {}) {
  const controller = createSiteTelemetryController(options);
  void controller.ensureSiteSession();
  controller.instrumentCtas();
  return controller;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  initMercuryMetricsSiteTelemetry();
}
