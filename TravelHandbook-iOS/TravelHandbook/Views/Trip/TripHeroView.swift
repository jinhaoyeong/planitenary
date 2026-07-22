import SwiftUI

/// Continuous auto-sliding strip matching web `Marquee`.
/// Width is isolated so the infinite HStack cannot break the parent ScrollView layout.
struct TripMarqueeView: View {
    let items: [String]
    var separator: String = "✦"

    @State private var unitWidth: CGFloat = 320

    private var source: [String] {
        items.isEmpty ? DEFAULT_TRIP_SETTINGS.marqueeItems : items
    }

    var body: some View {
        // Fixed-size host: prevents the scrolling HStack from expanding ScrollView content.
        Color.clear
            .frame(height: 64)
            .frame(maxWidth: .infinity)
            .overlay {
                TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { context in
                    let speed: CGFloat = 40
                    let cycle = max(unitWidth, 1)
                    let offset = CGFloat(context.date.timeIntervalSinceReferenceDate * Double(speed))
                        .truncatingRemainder(dividingBy: cycle)

                    HStack(spacing: 0) {
                        unitRow
                        unitRow
                    }
                    .background(
                        GeometryReader { geo in
                            Color.clear
                                .onAppear { unitWidth = max(geo.size.width / 2, 1) }
                                .onChange(of: geo.size.width) { _, width in
                                    unitWidth = max(width / 2, 1)
                                }
                        }
                    )
                    .offset(x: -offset)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .clipped()
            .background(ShellChrome.background)
            .overlay(alignment: .top) {
                Rectangle().fill(ShellChrome.ink.opacity(0.85)).frame(height: 1)
            }
            .overlay(alignment: .bottom) {
                Rectangle().fill(ShellChrome.ink.opacity(0.85)).frame(height: 1)
            }
    }

    private var unitRow: some View {
        HStack(spacing: 0) {
            ForEach(Array(source.enumerated()), id: \.offset) { _, item in
                HStack(spacing: 18) {
                    Text(item)
                        .font(.system(size: 26, weight: .regular, design: .serif))
                        .foregroundStyle(ShellChrome.ink)
                        .fixedSize()
                    Text(separator)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(ShellChrome.accent)
                        .fixedSize()
                }
                .padding(.horizontal, 12)
            }
        }
    }
}

/// Editorial hero + cover card matching the web trip shell.
struct TripHeroView: View {
    @ObservedObject var session: TripSession

    private var settings: TripAppSettings { session.tripSettings }
    private var itinerary: Itinerary? { session.itinerary }
    private var cities: [String] { itinerary?.cities ?? [] }
    private var dayCount: Int { itinerary?.days.count ?? 0 }

    private var coverStatusLabel: String {
        if cities.isEmpty { return settings.coverStatusEmpty }
        return applyTemplate(settings.coverStatusFilled, replacements: [
            "cities": cities.joined(separator: " · "),
        ])
    }

    private var coverModeLabel: String {
        cities.isEmpty ? settings.coverModeEmpty : settings.coverModeFilled
    }

    private var heroDescription: String {
        if let description = itinerary?.description, !description.isEmpty {
            return description
        }
        return settings.heroDescription
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 8) {
                Circle().fill(ShellChrome.accent).frame(width: 6, height: 6)
                Text(settings.heroEyebrow.uppercased())
                    .font(.caption.weight(.semibold))
                    .tracking(1.6)
                    .foregroundStyle(ShellChrome.ink)
            }

            Text(settings.heroHeadline)
                .font(.system(size: 36, weight: .regular, design: .serif))
                .foregroundStyle(ShellChrome.ink)
                .fixedSize(horizontal: false, vertical: true)

            Text(heroDescription)
                .font(.subheadline)
                .foregroundStyle(ShellChrome.inkMuted)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 10) {
                Button {
                    session.activeTab = .itinerary
                } label: {
                    Text(settings.heroPrimaryCta)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(Color(hex: "#0F0E0D"))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(ShellChrome.accent, in: Capsule())
                }
                .buttonStyle(.plain)

                Button {
                    session.activeTab = .maps
                } label: {
                    Text(settings.heroSecondaryCta)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(ShellChrome.ink)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .overlay(Capsule().stroke(ShellChrome.ink.opacity(0.55), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }

            coverCard
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 8)
    }

    private var coverCard: some View {
        ZStack(alignment: .topTrailing) {
            VStack(alignment: .leading, spacing: 12) {
                ZStack {
                    LinearGradient(
                        colors: [
                            ShellChrome.accentSoft,
                            ShellChrome.cardBackground,
                            ShellChrome.accent.opacity(0.35),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )

                    VStack(spacing: 12) {
                        HStack(spacing: 8) {
                            Circle().fill(ShellChrome.accent).frame(width: 6, height: 6)
                            Text(settings.coverLabel.uppercased())
                                .font(.caption.weight(.semibold))
                                .tracking(1.4)
                                .foregroundStyle(ShellChrome.ink)
                        }
                        Text(settings.coverHeadline)
                            .font(.system(size: 32, weight: .regular, design: .serif))
                            .multilineTextAlignment(.center)
                            .foregroundStyle(ShellChrome.ink)
                    }
                    .padding(20)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 220)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))

                HStack {
                    Text(coverStatusLabel)
                        .font(.system(.body, design: .serif).italic())
                        .foregroundStyle(ShellChrome.ink)
                    Spacer()
                    Text(coverModeLabel.uppercased())
                        .font(.caption2.weight(.bold))
                        .tracking(1.6)
                        .foregroundStyle(ShellChrome.inkMuted)
                }
                .padding(.horizontal, 4)
            }
            .padding(14)
            .frame(maxWidth: .infinity)
            .background(ShellChrome.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .stroke(ShellChrome.border, lineWidth: 1)
            )

            VStack(spacing: 2) {
                Text("\(dayCount)")
                    .font(.system(size: 26, weight: .regular, design: .serif))
                Text(settings.labels.daysLabel.uppercased())
                    .font(.system(size: 9, weight: .bold))
                    .tracking(1.2)
            }
            .foregroundStyle(Color(hex: "#0F0E0D"))
            .frame(width: 68, height: 68)
            .background(ShellChrome.accent)
            .clipShape(Circle())
            .shadow(color: Color.black.opacity(0.25), radius: 10, x: 0, y: 5)
            .offset(x: 4, y: -10)
        }
        .padding(.trailing, 8)
        .padding(.top, 10)
    }
}
