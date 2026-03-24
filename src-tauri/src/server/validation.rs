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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn test_is_valid_id() {
        assert!(is_valid_id("1234567890"));
        assert!(is_valid_id("1"));
        assert!(!is_valid_id(""));
        assert!(!is_valid_id("123a456"));
        assert!(!is_valid_id("123456789012345678901")); // 21 chars
    }

    #[test]
    fn test_is_valid_login() {
        assert!(is_valid_login("twitch_user"));
        assert!(is_valid_login("user123"));
        assert!(is_valid_login("A_B_C"));
        assert!(!is_valid_login(""));
        assert!(!is_valid_login("user-name"));
        assert!(!is_valid_login("user name"));
        assert!(!is_valid_login("a".repeat(26).as_str()));
    }

    #[test]
    fn test_is_ios_family_request() {
        let mut headers = HeaderMap::new();
        headers.insert(header::USER_AGENT, "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1".parse().unwrap());
        assert!(is_ios_family_request(&headers));

        let mut headers = HeaderMap::new();
        headers.insert(header::USER_AGENT, "Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1".parse().unwrap());
        assert!(is_ios_family_request(&headers));

        let mut headers = HeaderMap::new();
        headers.insert("sec-ch-ua-platform", "iOS".parse().unwrap());
        assert!(is_ios_family_request(&headers));

        let mut headers = HeaderMap::new();
        headers.insert(header::USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36".parse().unwrap());
        assert!(!is_ios_family_request(&headers));
    }

    #[test]
    fn test_filter_hevc_variants_for_ios() {
        let playlist = r#"#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1280000,CODECS="avc1.42e01e,mp4a.40.2"
chunklist_w109.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2560000,CODECS="hvc1.1.6.L93.B0,mp4a.40.2"
chunklist_w110.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=640000,CODECS="hev1.1.6.L93.B0,mp4a.40.2"
chunklist_w111.m3u8
"#;
        let filtered = filter_hevc_variants_for_ios(playlist);
        assert!(filtered.contains("chunklist_w109.m3u8"));
        assert!(!filtered.contains("chunklist_w110.m3u8"));
        assert!(!filtered.contains("chunklist_w111.m3u8"));
        assert!(filtered.contains("avc1.42e01e"));
    }
}
