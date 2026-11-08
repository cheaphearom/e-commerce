package com.thesis.common.logging;

import java.util.regex.Pattern;

/**
 * Replaces identifiers in URL paths with {@code {id}} so that access log lines for the same
 * endpoint share one path value (e.g. {@code /api/orders/3f2a...} becomes {@code /api/orders/{id}}).
 * Has no servlet dependency so the reactive gateway can use it too.
 */
public final class PathNormalizer {

    private static final Pattern UUID = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private static final Pattern NUMBER = Pattern.compile("\\d+");
    private static final Pattern BUSINESS_ID = Pattern.compile("[A-Za-z]{1,4}-\\d+");
    private static final Pattern HEX = Pattern.compile("[0-9a-fA-F]{16,}");

    private PathNormalizer() {
    }

    public static String normalize(String path) {
        if (path == null || path.isEmpty()) {
            return "/";
        }
        int query = path.indexOf('?');
        String clean = query >= 0 ? path.substring(0, query) : path;
        String[] segments = clean.split("/", -1);
        StringBuilder out = new StringBuilder(clean.length());
        for (int i = 0; i < segments.length; i++) {
            if (i > 0) {
                out.append('/');
            }
            out.append(isIdentifier(segments[i]) ? "{id}" : segments[i]);
        }
        String result = out.toString();
        return result.isEmpty() ? "/" : result;
    }

    private static boolean isIdentifier(String segment) {
        if (segment.isEmpty()) {
            return false;
        }
        return UUID.matcher(segment).matches()
                || NUMBER.matcher(segment).matches()
                || BUSINESS_ID.matcher(segment).matches()
                || HEX.matcher(segment).matches();
    }
}
