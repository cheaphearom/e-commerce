# syntax=docker/dockerfile:1.7
# One image recipe for every Spring Boot module:
#   docker build --build-arg MODULE=order-service -t order-service .

FROM maven:3.9.9-eclipse-temurin-21 AS build
ARG MODULE
WORKDIR /src
COPY pom.xml .
COPY common/pom.xml common/pom.xml
COPY api-gateway/pom.xml api-gateway/pom.xml
COPY order-service/pom.xml order-service/pom.xml
COPY inventory-service/pom.xml inventory-service/pom.xml
COPY payment-service/pom.xml payment-service/pom.xml
COPY common/src common/src
COPY ${MODULE}/src ${MODULE}/src
# The Maven repository is a build cache: a re-run after a network failure reuses every finished
# download. Retries and long timeouts make the build work on slow connections.
RUN --mount=type=cache,target=/root/.m2 \
    test -n "${MODULE}" && \
    mvn -B -q -pl ${MODULE} -am -DskipTests \
        -Daether.connector.http.retryHandler.count=10 \
        -Daether.connector.connectTimeout=60000 \
        -Daether.connector.requestTimeout=600000 \
        package

FROM eclipse-temurin:21-jre
ARG MODULE
RUN apt-get -o Acquire::Retries=10 update \
    && apt-get -o Acquire::Retries=10 install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 app \
    && mkdir -p /logs && chown app /logs
WORKDIR /app
COPY --from=build /src/${MODULE}/target/${MODULE}.jar /app/app.jar
ENV LOG_DIR=/logs \
    JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
USER app
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
