def test_health_returns_200(client):
    response = client.get("/health")
    assert response.status_code == 200


def test_health_returns_correct_payload(client):
    response = client.get("/health")
    data = response.json()
    assert data == {"status": "ok", "service": "ml-sidecar"}
