using Fm27Editor.Core.History;
using Fm27Editor.Core.Memory;
using Fm27Editor.Core.Offsets;
using Fm27Editor.Core.Players;

namespace Fm27Editor.Core.Clubs;

/// <summary>
/// The 14 extra-staff allowance fields stored on a human manager's <c>Mscc</c> record (measured from the game's
/// staff-allowance calculation function on Steam 27.1.0+2505117 at RVA <c>0x3AB9ABA..0x3AB9D33</c> and verified live
/// on Manchester United: Coaches <c>13/13 → 13/16</c>, Physios <c>7/6 → 7/10</c>, Scouts <c>16/16 → 16/21</c>).
/// </summary>
public enum StaffAllowanceField
{
    CoachesFirstTeam,
    CoachesU21,
    CoachesU18,
    PhysiosFirstTeam,
    PhysiosU21,
    PhysiosU18,
    SportsScientistsFirstTeam,
    SportsScientistsU21,
    SportsScientistsU18,
    PerformanceAnalystsFirstTeam,
    PerformanceAnalystsU21,
    PerformanceAnalystsU18,
    Scouts,
    RecruitmentAnalysts,
}

/// <summary>Immutable snapshot of a human manager's extra staff allowances.</summary>
public sealed record StaffAllowanceSnapshot(
    ulong HumanStaffAddress,
    ulong MsccAddress,
    IReadOnlyDictionary<StaffAllowanceField, byte> Values,
    byte[] RawBlock)
{
    public byte this[StaffAllowanceField field] => Values[field];
}

/// <summary>
/// Reader and guarded writer for a human manager's extra staff allowances (<c>db::HUMAN_NON_PLAYER</c> → <c>Mscc</c>).
/// Base allowances are computed on the fly from the club; <c>Mscc</c> exists only on <c>db::HUMAN_NON_PLAYER</c>, so
/// AI-managed clubs have no <c>Mscc</c> record and <see cref="ReadForClub"/> returns <c>null</c> for them.
/// </summary>
public sealed class StaffAllowanceAccess(IProcessMemory memory, OffsetProfile profile, ulong moduleBase)
{
    public const int BlockSize = 0x15;

    public static readonly IReadOnlyList<StaffAllowanceField> AllFields = Enum.GetValues<StaffAllowanceField>();

    /// <summary>Byte offset of <paramref name="field"/> relative to <c>staff.allowances.msccExtraStaff</c>.</summary>
    public static int RelativeOffset(StaffAllowanceField field) => field switch
    {
        StaffAllowanceField.CoachesFirstTeam => 0x00,
        StaffAllowanceField.CoachesU21 => 0x01,
        StaffAllowanceField.CoachesU18 => 0x02,
        StaffAllowanceField.PhysiosFirstTeam => 0x03,
        StaffAllowanceField.PhysiosU21 => 0x04,
        StaffAllowanceField.PhysiosU18 => 0x05,
        StaffAllowanceField.SportsScientistsFirstTeam => 0x09,
        StaffAllowanceField.SportsScientistsU21 => 0x0A,
        StaffAllowanceField.SportsScientistsU18 => 0x0B,
        StaffAllowanceField.PerformanceAnalystsFirstTeam => 0x0C,
        StaffAllowanceField.PerformanceAnalystsU21 => 0x0D,
        StaffAllowanceField.PerformanceAnalystsU18 => 0x0E,
        StaffAllowanceField.Scouts => 0x13,
        StaffAllowanceField.RecruitmentAnalysts => 0x14,
        _ => throw new ArgumentOutOfRangeException(nameof(field), field, null),
    };

    /// <summary>Maximum extra allowance the game's calculation function allows before clamping.</summary>
    public static int MaxValue(StaffAllowanceField field) => field switch
    {
        StaffAllowanceField.CoachesFirstTeam or StaffAllowanceField.CoachesU21 or StaffAllowanceField.CoachesU18 => 10,
        StaffAllowanceField.PhysiosFirstTeam or StaffAllowanceField.PhysiosU21 or StaffAllowanceField.PhysiosU18 => 10,
        StaffAllowanceField.SportsScientistsFirstTeam or StaffAllowanceField.SportsScientistsU21 or StaffAllowanceField.SportsScientistsU18 => 5,
        StaffAllowanceField.PerformanceAnalystsFirstTeam or StaffAllowanceField.PerformanceAnalystsU21 or StaffAllowanceField.PerformanceAnalystsU18 => 5,
        StaffAllowanceField.Scouts => 15,
        StaffAllowanceField.RecruitmentAnalysts => 5,
        _ => throw new ArgumentOutOfRangeException(nameof(field), field, null),
    };

    public static string Label(StaffAllowanceField field) => field switch
    {
        StaffAllowanceField.CoachesFirstTeam => "Extra Coaches (First Team)",
        StaffAllowanceField.CoachesU21 => "Extra Coaches (U21 / Reserve)",
        StaffAllowanceField.CoachesU18 => "Extra Coaches (U18 / Youth)",
        StaffAllowanceField.PhysiosFirstTeam => "Extra Physios (First Team)",
        StaffAllowanceField.PhysiosU21 => "Extra Physios (U21 / Reserve)",
        StaffAllowanceField.PhysiosU18 => "Extra Physios (U18 / Youth)",
        StaffAllowanceField.SportsScientistsFirstTeam => "Extra Sports Scientists (First Team)",
        StaffAllowanceField.SportsScientistsU21 => "Extra Sports Scientists (U21 / Reserve)",
        StaffAllowanceField.SportsScientistsU18 => "Extra Sports Scientists (U18 / Youth)",
        StaffAllowanceField.PerformanceAnalystsFirstTeam => "Extra Performance Analysts (First Team)",
        StaffAllowanceField.PerformanceAnalystsU21 => "Extra Performance Analysts (U21 / Reserve)",
        StaffAllowanceField.PerformanceAnalystsU18 => "Extra Performance Analysts (U18 / Youth)",
        StaffAllowanceField.Scouts => "Extra Scouts",
        StaffAllowanceField.RecruitmentAnalysts => "Extra Recruitment Analysts",
        _ => field.ToString(),
    };

    public bool IsSupported =>
        profile.Staff is { Allowances: not null } s && s.Kinds.Any(k => k.Manager);

    /// <summary>
    /// Reads the extra staff allowances for the human manager of <paramref name="clubAddress"/>, or <c>null</c> when
    /// the club is managed by an AI manager (or when the profile has no allowance offsets).
    /// </summary>
    public StaffAllowanceSnapshot? ReadForClub(ulong clubAddress)
    {
        if (clubAddress == 0
            || profile.Staff is not { Allowances: { } allowances } staffOffsets
            || profile.Club is not { Lists: { } lists } clubOffsets)
        {
            return null;
        }

        var managerKind = staffOffsets.Kinds.FirstOrDefault(k => k.Manager);
        if (managerKind is null) return null;

        Span<byte> buf = stackalloc byte[16];
        if (!memory.TryRead(clubAddress, buf[..8])
            || BitConverter.ToUInt64(buf[..8]) != moduleBase + clubOffsets.ClubVtableRva)
        {
            return null;
        }

        if (!memory.TryRead(clubAddress + (ulong)lists.Teams, buf))
            return null;

        ulong begin = BitConverter.ToUInt64(buf[..8]);
        ulong end = BitConverter.ToUInt64(buf[8..]);
        if (begin < 0x10000 || end <= begin || (end - begin) % 8 != 0 || (end - begin) / 8 > 32)
            return null;

        ulong expectedStaffVt = moduleBase + managerKind.StaffVtableRva;
        for (ulong p = begin; p < end; p += 8)
        {
            if (!memory.TryRead(p, buf[..8])) continue;
            ulong team = BitConverter.ToUInt64(buf[..8]);
            if (team < 0x10000) continue;
            if (!memory.TryRead(team + (ulong)allowances.TeamManager, buf[..8])) continue;
            ulong managerStaff = BitConverter.ToUInt64(buf[..8]);
            if (managerStaff < 0x10000) continue;
            if (!memory.TryRead(managerStaff, buf[..8])) continue;
            if (BitConverter.ToUInt64(buf[..8]) == expectedStaffVt)
                return ReadForStaff(managerStaff);
        }

        return null;
    }

    /// <summary>
    /// Reads the extra staff allowances from a human manager's staff-part address (<c>db::HUMAN_NON_PLAYER</c>).
    /// Returns <c>null</c> if the object is not a human manager or its <c>Mscc</c> pointer is null/unreadable.
    /// </summary>
    public StaffAllowanceSnapshot? ReadForStaff(ulong humanStaffAddress)
    {
        if (humanStaffAddress < 0x10000 || profile.Staff is not { Allowances: { } allowances } staffOffsets)
            return null;

        var managerKind = staffOffsets.Kinds.FirstOrDefault(k => k.Manager);
        if (managerKind is null) return null;

        Span<byte> ptrBuf = stackalloc byte[8];
        if (!memory.TryRead(humanStaffAddress, ptrBuf)
            || BitConverter.ToUInt64(ptrBuf) != moduleBase + managerKind.StaffVtableRva)
        {
            return null;
        }

        if (!memory.TryRead(humanStaffAddress + (ulong)allowances.HumanMscc, ptrBuf))
            return null;

        ulong mscc = BitConverter.ToUInt64(ptrBuf);
        if (mscc < 0x10000) return null;

        var raw = new byte[BlockSize];
        if (!memory.TryRead(mscc + (ulong)allowances.MsccExtraStaff, raw))
            return null;

        var values = new Dictionary<StaffAllowanceField, byte>(AllFields.Count);
        foreach (var field in AllFields)
            values[field] = raw[RelativeOffset(field)];

        return new StaffAllowanceSnapshot(humanStaffAddress, mscc, values, raw);
    }

    /// <summary>
    /// Guarded write of one extra-staff allowance field. Verifies the human manager vtable, the <c>Mscc</c> pointer,
    /// and the snapshot byte before writing, then reads back to confirm.
    /// </summary>
    public void Set(StaffAllowanceSnapshot snapshot, StaffAllowanceField field, int value)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        int max = MaxValue(field);
        if (value < 0 || value > max)
            throw new ArgumentOutOfRangeException(nameof(value), value, $"{Label(field)} must be between 0 and {max}.");

        if (profile.Staff is not { Allowances: { } allowances } staffOffsets)
            throw new InvalidOperationException("Profile has no staff allowance offsets.");

        var managerKind = staffOffsets.Kinds.FirstOrDefault(k => k.Manager)
            ?? throw new InvalidOperationException("Profile has no human manager staff kind.");

        Span<byte> ptrBuf = stackalloc byte[8];
        if (!memory.TryRead(snapshot.HumanStaffAddress, ptrBuf))
            throw new MemoryAccessException($"Cannot read human manager at 0x{snapshot.HumanStaffAddress:X}");
        if (BitConverter.ToUInt64(ptrBuf) != moduleBase + managerKind.StaffVtableRva)
            throw new StaleObjectException("The human manager object no longer has the expected vtable.");

        if (!memory.TryRead(snapshot.HumanStaffAddress + (ulong)allowances.HumanMscc, ptrBuf))
            throw new MemoryAccessException($"Cannot read Mscc pointer at 0x{snapshot.HumanStaffAddress + (ulong)allowances.HumanMscc:X}");
        if (BitConverter.ToUInt64(ptrBuf) != snapshot.MsccAddress)
            throw new StaleObjectException("The human manager's Mscc pointer changed since it was read.");

        ulong target = snapshot.MsccAddress + (ulong)allowances.MsccExtraStaff + (ulong)RelativeOffset(field);
        Span<byte> cur = stackalloc byte[1];
        if (!memory.TryRead(target, cur))
            throw new MemoryAccessException($"Cannot read {field} at 0x{target:X}");
        if (cur[0] != snapshot[field])
            throw new StaleObjectException($"{Label(field)} changed in memory since it was read (expected {snapshot[field]}, found {cur[0]}).");

        byte newByte = (byte)value;
        using var _ = ChangeContext.Describe(Label(field));
        if (!memory.TryWrite(target, [newByte]))
            throw new MemoryAccessException($"Failed to write {Label(field)} at 0x{target:X}");

        if (!memory.TryRead(target, cur) || cur[0] != newByte)
            throw new MemoryAccessException($"Read-back verification failed for {Label(field)} at 0x{target:X}");
    }
}
