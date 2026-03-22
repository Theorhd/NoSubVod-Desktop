use reqwest::Client;

pub async fn get_text_checked(client: &Client, url: &str) -> Result<String, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("GET {url}: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {url}", resp.status().as_u16()));
    }

    resp.text()
        .await
        .map_err(|e| format!("Reading response from {url}: {e}"))
}

pub async fn get_bytes_checked(client: &Client, url: &str) -> Result<bytes::Bytes, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("GET {url}: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {url}", resp.status().as_u16()));
    }

    resp.bytes()
        .await
        .map_err(|e| format!("Reading bytes from {url}: {e}"))
}

pub async fn get_text_with_direct_fallback(
    primary_client: &Client,
    fallback_client: &Client,
    url: &str,
    context: &str,
) -> Result<String, String> {
    match primary_client.get(url).send().await {
        Ok(resp) if resp.status().is_success() => resp.text().await.map_err(|e| e.to_string()),
        Ok(resp) => {
            eprintln!(
                "[adblock] proxy returned HTTP {} for {context}, retrying direct",
                resp.status()
            );
            get_text_checked(fallback_client, url).await
        }
        Err(error) => {
            eprintln!("[adblock] proxy error for {context} ({error}), retrying direct");
            get_text_checked(fallback_client, url).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_text_checked_signature_is_send_safe() {
        fn assert_send<T: Send>(_: &T) {}
        let client = Client::new();
        let fut = get_text_checked(&client, "https://example.com");
        assert_send(&fut);
        std::mem::drop(fut);
    }
}
