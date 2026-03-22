use axum::http::header;

/// Returns true if the string looks like a valid VOD / numeric ID.
pub fn is_valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 20 && s.chars().all(|c| c.is_ascii_digit())
}

/// Returns true if the string looks like a valid Twitch login/username.
pub fn is_valid_login(s: &str) -> bool {
    !s.is_empty() && s.len() <= 25 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub fn is_ios_family_request(headers: &axum::http::HeaderMap) -> bool {
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    if ua.contains("iphone") || ua.contains("ipad") || ua.contains("ipod") {
        return true;
    }

    if ua.contains("macintosh") && ua.contains("mobile") {
        return true;
    }

    let platform = headers
        .get("sec-ch-ua-platform")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    platform.contains("ios")
}

pub fn filter_hevc_variants_for_ios(master_playlist: &str) -> String {
    let mut output: Vec<&str> = Vec::new();
    let mut lines = master_playlist.lines().peekable();

    while let Some(line) = lines.next() {
        let trimmed = line.trim();

        if trimmed.starts_with("#EXT-X-STREAM-INF") {
            let lowered = trimmed.to_lowercase();
            let is_hevc = lowered.contains("codecs=\"")
                && (lowered.contains("hvc1") || lowered.contains("hev1"));

            if is_hevc {
                let _ = lines.next();
                continue;
            }
        }

        output.push(line);
    }

    output.join("\n")
}
