/**
 * StudySmart quiz API — minimal ESP32 client (Arduino framework).
 *
 * 1. Install board support: ESP32 by Espressif.
 * 2. Library: ArduinoJson v6 (DynamicJsonDocument), e.g. 6.21.x.
 * 3. Set WIFI_SSID, WIFI_PASS, API_HOST below (API_HOST = PC IP running the API).
 * 4. Run API: cd studysmart/api && npm install && npm start
 *
 * Serial monitor @ 115200: prints topics, fetches first question, verifies choice 0.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char *WIFI_SSID = "YOUR_SSID";
const char *WIFI_PASS = "YOUR_PASSWORD";
// LAN IP of machine running Node API (not 127.0.0.1 from ESP32's view)
const char *API_HOST = "192.168.1.100";
const uint16_t API_PORT = 3333;

String apiBase() {
  return String("http://") + API_HOST + ":" + API_PORT;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.print("WiFi ");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println(" OK");
  Serial.println(WiFi.localIP());

  if (!fetchTopics()) return;
  if (!fetchQuestion("science", 0)) return;
  if (!verifyAnswer("science", 0, 1)) return; // H2O = index 1
  Serial.println("Done.");
}

void loop() {
  delay(60000);
}

bool fetchTopics() {
  HTTPClient http;
  String url = apiBase() + "/api/topics";
  http.begin(url);
  int code = http.GET();
  Serial.printf("GET /api/topics -> %d\n", code);
  if (code != 200) {
    http.end();
    return false;
  }
  String body = http.getString();
  http.end();

  DynamicJsonDocument doc(2048);
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.println(err.c_str());
    return false;
  }
  JsonArray arr = doc["topics"].as<JsonArray>();
  for (JsonObject t : arr) {
    Serial.printf("  topic %s: %s (%d q)\n",
                  t["id"].as<const char *>(),
                  t["title"].as<const char *>(),
                  (int)t["n"]);
  }
  return true;
}

bool fetchQuestion(const char *topicId, int index) {
  HTTPClient http;
  String url = apiBase() + "/api/question/" + topicId + "/" + index;
  http.begin(url);
  int code = http.GET();
  Serial.printf("GET question -> %d\n", code);
  if (code != 200) {
    http.end();
    return false;
  }
  String body = http.getString();
  http.end();

  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, body)) {
    Serial.println("JSON parse error");
    return false;
  }
  Serial.println(doc["q"].as<const char *>());
  JsonArray choices = doc["c"].as<JsonArray>();
  int n = 0;
  for (JsonVariant v : choices) {
    Serial.printf("  [%d] %s\n", n++, v.as<const char *>());
  }
  return true;
}

bool verifyAnswer(const char *topicId, int qIndex, int choiceIndex) {
  HTTPClient http;
  String url = apiBase() + "/api/verify";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  DynamicJsonDocument payload(256);
  payload["topicId"] = topicId;
  payload["i"] = qIndex;
  payload["choice"] = choiceIndex;
  String json;
  serializeJson(payload, json);

  int code = http.POST(json);
  Serial.printf("POST /api/verify -> %d\n", code);
  if (code != 200) {
    http.end();
    return false;
  }
  String body = http.getString();
  http.end();

  DynamicJsonDocument doc(256);
  if (deserializeJson(doc, body)) return false;
  bool correct = doc["correct"].as<bool>();
  int answer = doc["answer"].as<int>();
  Serial.printf("correct=%d server_answer_index=%d\n", correct, answer);
  return true;
}
