import SwiftUI

struct WelcomeView: View {
    var onFinish: () -> Void = {}

    @EnvironmentObject private var theme: ThemeManager
    @State private var activeIndex = 0

    private let slides: [WelcomeSlide] = [
        WelcomeSlide(
            eyebrow: "Welcome",
            titleTop: "Plan trips",
            titleAccent: "beautifully.",
            body: "A clean travel handbook for building your itinerary, one day at a time, with a layout that feels like a real iOS app.",
            systemImage: "sparkles",
            cardTitle: "A calm start",
            cardBody: "Swipe through this short intro to see how the app works."
        ),
        WelcomeSlide(
            eyebrow: "Itinerary",
            titleTop: "Build days",
            titleAccent: "your way.",
            body: "Add cities, activities, notes, and timing details so each day reads like a polished travel plan instead of a messy checklist.",
            systemImage: "book.closed",
            cardTitle: "Day-by-day planning",
            cardBody: "Keep structure clear while still leaving space for flexible plans."
        ),
        WelcomeSlide(
            eyebrow: "Maps",
            titleTop: "See places",
            titleAccent: "faster.",
            body: "Jump between your itinerary and maps to understand where you are going, what is nearby, and how your trip flows in real space.",
            systemImage: "map",
            cardTitle: "Location context",
            cardBody: "Useful for city hopping, route planning, and spot clustering."
        ),
        WelcomeSlide(
            eyebrow: "Budget",
            titleTop: "Track spend",
            titleAccent: "clearly.",
            body: "Keep travel costs, notes, and quick references in one place, so your handbook stays useful before, during, and after the trip.",
            systemImage: "wallet.pass",
            cardTitle: "Practical tools",
            cardBody: "Budgets, documents, and checklists stay close to the main trip flow."
        ),
        WelcomeSlide(
            eyebrow: "Memories",
            titleTop: "Save the story",
            titleAccent: "with photos.",
            body: "Upload cover images, keep photo moments, and personalize the handbook so every trip feels like your own travel journal.",
            systemImage: "camera",
            cardTitle: "Ready to begin",
            cardBody: "Start with a blank trip and shape the app around your journey."
        ),
    ]

    private var isLastSlide: Bool { activeIndex == slides.count - 1 }

    var body: some View {
        ZStack {
            ShellChrome.background.ignoresSafeArea()
            RadialGradient(
                colors: [ShellChrome.accent.opacity(0.18), .clear],
                center: .topTrailing,
                startRadius: 20,
                endRadius: 420
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    HStack(spacing: 8) {
                        Circle().fill(ShellChrome.accent).frame(width: 6, height: 6)
                        Text("Travel handbook")
                            .font(.caption.weight(.semibold))
                            .tracking(2)
                            .textCase(.uppercase)
                            .foregroundStyle(ShellChrome.ink)
                    }
                    Spacer()
                    Button("Skip") {
                        Haptics.lightImpact()
                        finishOnboarding()
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ShellChrome.inkMuted)
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)

                TabView(selection: $activeIndex) {
                    ForEach(Array(slides.enumerated()), id: \.offset) { index, slide in
                        slideCard(slide, index: index)
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(.easeOut(duration: 0.28), value: activeIndex)

                pageDots
                    .padding(.top, 8)

                HStack(spacing: 12) {
                    Button {
                        Haptics.selectionChanged()
                        activeIndex = max(activeIndex - 1, 0)
                    } label: {
                        Label("Back", systemImage: "arrow.left")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PillButtonStyle(variant: .soft))
                    .disabled(activeIndex == 0)
                    .opacity(activeIndex == 0 ? 0.4 : 1)

                    Button {
                        Haptics.mediumImpact()
                        if isLastSlide {
                            finishOnboarding()
                        } else {
                            activeIndex = min(activeIndex + 1, slides.count - 1)
                        }
                    } label: {
                        HStack {
                            Text(isLastSlide ? "Start planning" : "Continue")
                            Image(systemName: "arrow.right")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PillButtonStyle(variant: .primary))
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)

                Text("Swipe left or right to move through the intro.")
                    .font(.caption)
                    .foregroundStyle(ShellChrome.inkMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.top, 12)
                    .padding(.bottom, 16)
            }
        }
        .handbookTheme(theme)
    }

    private func slideCard(_ slide: WelcomeSlide, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                HStack(spacing: 8) {
                    Circle().fill(ShellChrome.accent).frame(width: 6, height: 6)
                    Text(slide.eyebrow.uppercased())
                        .font(.caption.weight(.semibold))
                        .tracking(2)
                        .foregroundStyle(ShellChrome.ink)
                }
                Spacer()
                Image(systemName: slide.systemImage)
                    .font(.title3)
                    .foregroundStyle(ShellChrome.accent)
                    .frame(width: 48, height: 48)
                    .background(ShellChrome.accentSoft, in: Circle())
            }

            Text(slide.titleTop)
                .font(.system(size: 42, weight: .regular, design: .serif))
                .foregroundStyle(ShellChrome.ink)
                .padding(.top, 20)
            Text(slide.titleAccent)
                .font(.system(size: 42, weight: .regular, design: .serif))
                .italic()
                .foregroundStyle(ShellChrome.accent)

            Text(slide.body)
                .font(.body)
                .foregroundStyle(ShellChrome.inkMuted)
                .lineSpacing(4)
                .padding(.top, 16)

            VStack(alignment: .leading, spacing: 8) {
                Text("\(index + 1) / \(slides.count)")
                    .font(.caption2.weight(.bold))
                    .tracking(2)
                    .textCase(.uppercase)
                    .foregroundStyle(ShellChrome.inkMuted)
                Text(slide.cardTitle)
                    .font(.system(.title, design: .serif))
                    .foregroundStyle(ShellChrome.ink)
                Text(slide.cardBody)
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
                    .lineSpacing(3)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(ShellChrome.accentSoft.opacity(0.55), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .stroke(ShellChrome.border, lineWidth: 1)
            )
            .padding(.top, 24)
        }
        .padding(22)
        .background(ShellChrome.cardBackground, in: RoundedRectangle(cornerRadius: 32, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 32, style: .continuous)
                .stroke(ShellChrome.border, lineWidth: 1)
        )
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    private var pageDots: some View {
        HStack(spacing: 6) {
            ForEach(0..<slides.count, id: \.self) { index in
                Button {
                    Haptics.selectionChanged()
                    activeIndex = index
                } label: {
                    Capsule()
                        .fill(index == activeIndex ? ShellChrome.accent : ShellChrome.ink.opacity(0.22))
                        .frame(width: index == activeIndex ? 28 : 8, height: 8)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func finishOnboarding() {
        LocalStore.markVisited()
        onFinish()
    }
}

private struct WelcomeSlide {
    let eyebrow: String
    let titleTop: String
    let titleAccent: String
    let body: String
    let systemImage: String
    let cardTitle: String
    let cardBody: String
}

@MainActor
enum EmberRoseTheme {
    static var paperBackground: Color { ShellChrome.background }
    static var cardBackground: Color { ShellChrome.cardBackground }
    static var accent: Color { ShellChrome.accent }
    static var accentSoft: Color { ShellChrome.accentSoft }
    static var ink: Color { ShellChrome.ink }
    static var inkMuted: Color { ShellChrome.inkMuted }
    static var border: Color { ShellChrome.border }
}

struct PillButtonStyle: ButtonStyle {
    enum Variant { case primary, soft }

    var variant: Variant = .primary

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .padding(.vertical, 14)
            .padding(.horizontal, 18)
            .background(backgroundColor(isPressed: configuration.isPressed), in: Capsule())
            .foregroundStyle(foregroundColor)
            .overlay(
                Capsule().stroke(variant == .soft ? ShellChrome.border : Color.clear, lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.9 : 1)
    }

    private var foregroundColor: Color {
        variant == .primary ? Color(hex: "#0F0E0D") : ShellChrome.inkMuted
    }

    private func backgroundColor(isPressed: Bool) -> Color {
        switch variant {
        case .primary:
            return isPressed ? ShellChrome.accent.opacity(0.85) : ShellChrome.accent
        case .soft:
            return isPressed ? ShellChrome.cardBackground.opacity(0.7) : ShellChrome.cardBackground
        }
    }
}

#Preview {
    WelcomeView()
        .environmentObject(ThemeManager())
}
