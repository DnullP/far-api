/**
 * Regression test for ResponseViewer hook order fix.
 *
 * The original bug: useMemo was placed after early returns, causing React to
 * see a different number of hooks between renders (null response → valid response).
 * This test verifies the component renders correctly in all three states
 * (empty, loading, with response) and can transition between them without
 * triggering hook order errors.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResponseViewer } from "../src/components/ResponseViewer";
import type { ApiResponse } from "../src/types/api";

const mockResponse: ApiResponse = {
  status: 200,
  statusText: "OK",
  headers: { "content-type": "application/json", "x-request-id": "abc123" },
  body: '{"message":"hello"}',
  time: 42,
  size: 19,
};

const errorResponse: ApiResponse = {
  status: 500,
  statusText: "Internal Server Error",
  headers: { "content-type": "text/plain" },
  body: "something went wrong",
  time: 100,
  size: 20,
};

describe("ResponseViewer", () => {
  it("renders empty state when response is null", () => {
    const { container } = render(<ResponseViewer response={null} />);
    expect(container.querySelector(".response-empty")).toBeInTheDocument();
    expect(screen.getByText("Send a request to see the response")).toBeInTheDocument();
  });

  it("renders loading state", () => {
    const { container } = render(<ResponseViewer response={null} loading />);
    expect(container.querySelector(".response-loading")).toBeInTheDocument();
    expect(screen.getByText("Sending request...")).toBeInTheDocument();
  });

  it("renders response with status, time, and size", () => {
    render(<ResponseViewer response={mockResponse} />);
    expect(screen.getByText("200 OK")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();
    expect(screen.getByText("19 B")).toBeInTheDocument();
  });

  it("renders error status with correct class", () => {
    const { container } = render(<ResponseViewer response={errorResponse} />);
    const statusEl = container.querySelector(".status-error");
    expect(statusEl).toBeInTheDocument();
    expect(statusEl).toHaveTextContent("500 Internal Server Error");
  });

  it("formats JSON body with syntax highlighting", () => {
    const { container } = render(<ResponseViewer response={mockResponse} />);
    const codeEl = container.querySelector("code");
    expect(codeEl).toBeInTheDocument();
    // The highlighted HTML should contain the formatted JSON
    expect(codeEl!.innerHTML).toContain("message");
    expect(codeEl!.innerHTML).toContain("hello");
  });

  it("can switch between body and headers tabs", () => {
    render(<ResponseViewer response={mockResponse} />);
    // Body tab active by default
    expect(screen.getByText("Body").className).toContain("active");

    // Switch to headers
    fireEvent.click(screen.getByText("Headers"));
    expect(screen.getByText("Headers").className).toContain("active");
    expect(screen.getByText("content-type")).toBeInTheDocument();
    expect(screen.getByText("application/json")).toBeInTheDocument();
    expect(screen.getByText("x-request-id")).toBeInTheDocument();
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });

  /**
   * CRITICAL REGRESSION TEST: Ensures no hook order violation when transitioning
   * from null response (empty state) to a valid response. The original bug
   * placed useMemo after early returns, which React detected as a hook count change.
   */
  it("transitions from null → loading → response without hook order errors", () => {
    const { rerender } = render(<ResponseViewer response={null} />);
    expect(screen.getByText("Send a request to see the response")).toBeInTheDocument();

    // Transition to loading
    rerender(<ResponseViewer response={null} loading />);
    expect(screen.getByText("Sending request...")).toBeInTheDocument();

    // Transition to response
    rerender(<ResponseViewer response={mockResponse} />);
    expect(screen.getByText("200 OK")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();
  });

  it("transitions from response → null → response without errors", () => {
    const { rerender } = render(<ResponseViewer response={mockResponse} />);
    expect(screen.getByText("200 OK")).toBeInTheDocument();

    // Back to empty
    rerender(<ResponseViewer response={null} />);
    expect(screen.getByText("Send a request to see the response")).toBeInTheDocument();

    // New response
    rerender(<ResponseViewer response={errorResponse} />);
    expect(screen.getByText("500 Internal Server Error")).toBeInTheDocument();
  });

  it("displays size in KB for responses over 1024 bytes", () => {
    const largeResponse: ApiResponse = {
      ...mockResponse,
      size: 2048,
    };
    render(<ResponseViewer response={largeResponse} />);
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });
});
