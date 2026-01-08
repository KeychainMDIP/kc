package org.keychain.gatekeeper;

import java.time.Duration;

public class GatekeeperClientOptions {
    public String baseUrl;
    public Duration connectTimeout;
    public Duration readTimeout;
    public String headerName;
    public String headerValue;

    public GatekeeperClientOptions() {
        this.baseUrl = "http://localhost:4224";
        this.connectTimeout = Duration.ofSeconds(10);
        this.readTimeout = Duration.ofSeconds(30);
    }
}
