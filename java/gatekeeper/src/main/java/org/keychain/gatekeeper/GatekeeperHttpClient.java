package org.keychain.gatekeeper;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.time.Duration;
import java.util.Objects;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.GatekeeperError;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ResolveDIDOptions;

public class GatekeeperHttpClient implements GatekeeperClient {
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final OkHttpClient http;
    private final ObjectMapper mapper;
    private final HttpUrl baseUrl;
    private final String headerName;
    private final String headerValue;

    public GatekeeperHttpClient(GatekeeperClientOptions options) {
        Objects.requireNonNull(options, "options is required");
        this.mapper = new ObjectMapper()
            .setSerializationInclusion(JsonInclude.Include.NON_NULL);
        String base = options.url != null ? options.url : options.baseUrl;
        if (base.endsWith("/api/v1")) {
            base = base.substring(0, base.length() - "/api/v1".length());
        } else if (base.endsWith("/api/v1/")) {
            base = base.substring(0, base.length() - "/api/v1/".length());
        }
        this.baseUrl = HttpUrl.parse(base + "/api/v1");
        if (this.baseUrl == null) {
            throw new IllegalArgumentException("Invalid baseUrl");
        }

        Duration connectTimeout = options.connectTimeout != null ? options.connectTimeout : Duration.ofSeconds(10);
        Duration readTimeout = options.readTimeout != null ? options.readTimeout : Duration.ofSeconds(30);

        this.http = new OkHttpClient.Builder()
            .connectTimeout(connectTimeout)
            .readTimeout(readTimeout)
            .build();

        this.headerName = options.headerName;
        this.headerValue = options.headerValue;
    }

    @Override
    public String createDID(Operation operation) {
        return postJson("/did", operation, String.class);
    }

    @Override
    public MdipDocument resolveDID(String did, ResolveDIDOptions options) {
        HttpUrl.Builder url = baseUrl.newBuilder().addPathSegment("did").addPathSegment(did);
        if (options != null) {
            if (options.versionTime != null) {
                url.addQueryParameter("versionTime", options.versionTime);
            }
            if (options.versionSequence != null) {
                url.addQueryParameter("versionSequence", options.versionSequence.toString());
            }
            if (options.confirm != null) {
                url.addQueryParameter("confirm", options.confirm.toString());
            }
            if (options.verify != null) {
                url.addQueryParameter("verify", options.verify.toString());
            }
        }
        return getJson(url.build(), MdipDocument.class);
    }

    @Override
    public boolean updateDID(Operation operation) {
        return postJson("/did", operation, Boolean.class);
    }

    @Override
    public boolean deleteDID(Operation operation) {
        return postJson("/did", operation, Boolean.class);
    }

    @Override
    public BlockInfo getBlock(String registry) {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("block")
            .addPathSegment(registry)
            .addPathSegment("latest")
            .build();
        return getJson(url, BlockInfo.class);
    }

    private <T> T postJson(String path, Object body, Class<T> responseType) {
        try {
            String json = mapper.writeValueAsString(body);
            RequestBody requestBody = RequestBody.create(json, JSON);
            Request request = new Request.Builder()
                .url(baseUrl.newBuilder().addPathSegments(trimLeadingSlash(path)).build())
                .post(requestBody)
                .build();

            return execute(request, responseType);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to serialize request", e);
        }
    }

    private <T> T getJson(HttpUrl url, Class<T> responseType) {
        Request request = new Request.Builder()
            .url(url)
            .get()
            .build();
        return execute(request, responseType);
    }

    private <T> T execute(Request request, Class<T> responseType) {
        Request.Builder builder = request.newBuilder();
        if (headerName != null && headerValue != null) {
            builder.addHeader(headerName, headerValue);
        }

        try (Response response = http.newCall(builder.build()).execute()) {
            String body = response.body() != null ? response.body().string() : "";
            if (!response.isSuccessful()) {
                GatekeeperError error = GatekeeperErrorParser.parse(body);
                throw new GatekeeperClientException("Gatekeeper request failed", response.code(), error);
            }

            if (responseType == String.class) {
                try {
                    return responseType.cast(mapper.readValue(body, String.class));
                } catch (Exception e) {
                    return responseType.cast(body);
                }
            }

            if (body == null || body.isEmpty()) {
                return null;
            }

            return mapper.readValue(body, responseType);
        } catch (IOException e) {
            throw new IllegalStateException("Gatekeeper request failed", e);
        }
    }

    private static String trimLeadingSlash(String path) {
        if (path == null) {
            return "";
        }
        return path.startsWith("/") ? path.substring(1) : path;
    }
}
