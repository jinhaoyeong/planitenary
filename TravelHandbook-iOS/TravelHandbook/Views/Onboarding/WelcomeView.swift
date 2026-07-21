import SwiftUI

struct WelcomeView: View {
    var onFinish: () -> Void = {}

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
            EmberRoseTheme.paperBackground.ignoresSafeArea()
            RadialGradient(
                colors: [EmberRoseTheme.accent.opacity(0.16), .clear],
                center: .top,
                startRadius: 0,
                endRadius: 420
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    Text("Travel handbook")
                        .font(.caption.weight(.semibold))
                        .tracking(2)
                        .textCase(.uppercase)
                        .foregroundStyle(EmberRoseTheme.inkMuted)
                    Spacer()
                    Button("Skip") {
                        Haptics.lightImpact()
                        finishOnboarding()
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberRoseTheme.inkMuted)
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
                        Label(isLastSlide ? "Start planning" : "Continue", systemImage: "arrow.right")
                            .labelStyle(.titleAndIcon)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PillButtonStyle(variant: .primary))
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)

                Text("Swipe left or right to move through the intro.")
                    .font(.caption)
                    .foregroundStyle(EmberRoseTheme.inkMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.top, 12)
                    .padding(.bottom, 16)
            }
        }
    }

    private func slideCard(_ slide: WelcomeSlide, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(slide.eyebrow)
                    .font(.caption.weight(.semibold))
                    .tracking(2)
                    .textCase(.uppercase)
                    .foregroundStyle(EmberRoseTheme.inkMuted)
                Spacer()
                Image(systemName: slide.systemImage)
                    .font(.title2)
                    .foregroundStyle(EmberRoseTheme.accent)
                    .frame(width: 48, height: 48)
                    .background(EmberRoseTheme.accentSoft, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }

            Text(slide.titleTop)
                .font(.system(size: 42, weight: .regular, design: .serif))
                .foregroundStyle(EmberRoseTheme.ink)
                .padding(.top, 20)
            Text(slide.titleAccent)
                .font(.system(size: 42, weight: .regular, design: .serif))
                .italic()
                .foregroundStyle(EmberRoseTheme.accent)

            Text(slide.body)
                .font(.body)
                .foregroundStyle(EmberRoseTheme.inkMuted)
                .lineSpacing(4)
                .padding(.top, 16)

            VStack(alignment: .leading, spacing: 8) {
                Text("\(index + 1) / \(slides.count)")
                    .font(.caption2.weight(.bold))
                    .tracking(2)
                    .textCase(.uppercase)
                    .foregroundStyle(EmberRoseTheme.inkMuted)
                Text(slide.cardTitle)
                    .font(.system(.title, design: .serif))
                    .foregroundStyle(EmberRoseTheme.ink)
                Text(slide.cardBody)
                    .font(.subheadline)
                    .foregroundStyle(EmberRoseTheme.inkMuted)
                    .lineSpacing(3)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(
                    colors: [EmberRoseTheme.accentSoft.opacity(0.9), EmberRoseTheme.cardBackground],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                in: RoundedRectangle(cornerRadius: 28, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .stroke(EmberRoseTheme.border, lineWidth: 1)
            )
            .padding(.top, 24)
        }
        .padding(22)
        .background(EmberRoseTheme.cardBackground, in: RoundedRectangle(cornerRadius: 32, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 32, style: .continuous)
                .stroke(EmberRoseTheme.border, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.04), radius: 24, y: 8)
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
                        .fill(index == activeIndex ? EmberRoseTheme.accent : EmberRoseTheme.ink.opacity(0.14))
                        .frame(width: index == activeIndex ? 28 : 8, height: 8)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Go to intro page \(index + 1)")
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

enum EmberRoseTheme {
    static let paperBackground = Color(red: 250 / 255, green: 247 / 255, blue: 242 / 255)
    static let cardBackground = Color.white
    static let accent = Color(red: 238 / 255, green: 77 / 255, blue: 135 / 255)
    static let accentSoft = Color(red: 253 / 255, green: 232 / 255, blue: 239 / 255)
    static let ink = Color(red: 28 / 255, green: 25 / 255, blue: 23 / 255)
    static let inkMuted = Color(red: 87 / 255, green: 83 / 255, blue: 78 / 255)
    static let border = Color.black.opacity(0.08)
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
    }

    private var foregroundColor: Color {
        variant == .primary ? .white : EmberRoseTheme.ink
    }

    private func backgroundColor(isPressed: Bool) -> Color {
        switch variant {
        case .primary:
            return isPressed ? EmberRoseTheme.accent.opacity(0.85) : EmberRoseTheme.accent
        case .soft:
            return isPressed ? EmberRoseTheme.accentSoft.opacity(0.7) : EmberRoseTheme.accentSoft
        }
    }
}

#Preview {
    WelcomeView()
}
