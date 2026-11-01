use std::{io, path::Path, time::Duration};

/// Stream into a sibling temporary file so failed transfers never damage an existing file.
pub fn save_url(url: &str, destination: &Path, expected_size: u64) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid download URL.")?;
    if !matches!(parsed.scheme(), "https" | "http")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Download URL must use HTTP or HTTPS without credentials.".into());
    }
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(3600))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not initialize file download.")?;
    // No Clerk JWT, unit token or cookies are sent to the storage provider.
    let mut response = client
        .get(parsed)
        .send()
        .map_err(|_| "Could not reach storage. Check the connection and retry.")?;
    if !response.status().is_success() {
        return Err(format!(
            "Storage returned HTTP {}. Request a new download and retry.",
            response.status().as_u16()
        ));
    }
    let parent = destination.parent().ok_or("Invalid destination folder.")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "Could not create a temporary file in the destination folder.")?;
    let copied = io::copy(&mut response, temporary.as_file_mut())
        .map_err(|_| "Download was interrupted. The destination file was not changed.")?;
    if copied != expected_size {
        return Err("Downloaded file size does not match the artifact. The destination file was not changed.".into());
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| "Could not finish writing the downloaded file.")?;
    temporary
        .persist(destination)
        .map_err(|_| "Could not save the downloaded file. Check destination permissions.")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };
    fn server(status: &str, body: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file", listener.local_addr().unwrap());
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let count = socket.read(&mut request).unwrap();
            assert!(
                !String::from_utf8_lossy(&request[..count])
                    .to_lowercase()
                    .contains("authorization:")
            );
            socket.write_all(response.as_bytes()).unwrap();
        });
        url
    }
    #[test]
    fn downloads_bytes_and_preserves_existing_destination_on_errors() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("artifact.txt");
        save_url(&server("200 OK", "artifact"), &path, 8).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"artifact");
        assert!(
            save_url(&server("403 Forbidden", "denied"), &path, 6)
                .unwrap_err()
                .contains("403")
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"artifact");
        assert!(save_url(&server("200 OK", "short"), &path, 8).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"artifact");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        assert!(save_url("file:///etc/passwd", &path, 0).is_err());
    }
}
