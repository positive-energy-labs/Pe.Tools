namespace Pe.Extensions.FamDocument.SetValue.CoercionStrategies;

/// <summary>
///     Coercion strategy for converting measurable parameters (Mass, Length, Volume, etc.) to unitless Number parameters.
///     Applies standard engineering unit conversions based on the source parameter's data type.
///     Common conversions:
///     - Mass → pounds (lb)
///     - Length → feet (ft)
///     - Area → square feet (sf)
///     - Volume → cubic feet (cf)
///     - Force → pounds-force (lbf)
///     - Electrical → standard US units
/// </summary>
public class CoerceMeasurableToNumber : ICoercionStrategy {
    /// <summary>
    ///     Mapping of Revit SpecTypeId to target display units for conversion to Number.
    ///     Uses common US engineering units as defaults.
    ///     Uses ForgeTypeId for compile-time safety and version independence.
    /// </summary>
    private static readonly Dictionary<ForgeTypeId, ForgeTypeId> DefaultTargetUnits = new() {
        // ═══════════════════════════════════════════════════════════
        // COMMON DISCIPLINE
        // ═══════════════════════════════════════════════════════════

        // Length & Distance (Revit internal unit: feet)
        { SpecTypeId.Length, UnitTypeId.Feet },
        { SpecTypeId.Distance, UnitTypeId.Feet },

        // Area (Revit internal unit: square feet)
        { SpecTypeId.Area, UnitTypeId.SquareFeet },

        // Volume (Revit internal unit: cubic feet)
        { SpecTypeId.Volume, UnitTypeId.CubicFeet },

        // Angle
        { SpecTypeId.Angle, UnitTypeId.Degrees },
        { SpecTypeId.RotationAngle, UnitTypeId.Degrees },
        { SpecTypeId.SiteAngle, UnitTypeId.Degrees },

        // Other Common
        { SpecTypeId.Slope, UnitTypeId.RiseDividedBy12Inches },
        { SpecTypeId.Speed, UnitTypeId.FeetPerSecond },
        { SpecTypeId.Time, UnitTypeId.Seconds },
        { SpecTypeId.MassDensity, UnitTypeId.PoundsMassPerCubicFoot },
        { SpecTypeId.CostPerArea, UnitTypeId.CurrencyPerSquareFoot },
        { SpecTypeId.Currency, UnitTypeId.Currency },

        // ═══════════════════════════════════════════════════════════
        // STRUCTURAL DISCIPLINE
        // ═══════════════════════════════════════════════════════════

        // Mass & Weight
        { SpecTypeId.Mass, UnitTypeId.PoundsMass },
        { SpecTypeId.Weight, UnitTypeId.PoundsForce },
        { SpecTypeId.MassPerUnitArea, UnitTypeId.PoundsMassPerSquareFoot },
        { SpecTypeId.MassPerUnitLength, UnitTypeId.PoundsMassPerFoot },
        { SpecTypeId.WeightPerUnitLength, UnitTypeId.PoundsForcePerFoot },
        { SpecTypeId.UnitWeight, UnitTypeId.PoundsForcePerCubicFoot },

        // Force
        { SpecTypeId.Force, UnitTypeId.PoundsForce },
        { SpecTypeId.LinearForce, UnitTypeId.PoundsForcePerFoot },
        { SpecTypeId.AreaForce, UnitTypeId.PoundsForcePerSquareFoot },
        { SpecTypeId.ForceScale, UnitTypeId.PoundsForce },
        { SpecTypeId.LinearForceScale, UnitTypeId.PoundsForcePerFoot },
        { SpecTypeId.AreaForceScale, UnitTypeId.PoundsForcePerSquareFoot },

        // Moment
        { SpecTypeId.Moment, UnitTypeId.PoundForceFeet },
        { SpecTypeId.LinearMoment, UnitTypeId.PoundForceFeetPerFoot },
        { SpecTypeId.MomentScale, UnitTypeId.PoundForceFeet },
        { SpecTypeId.LinearMomentScale, UnitTypeId.PoundForceFeetPerFoot },
        { SpecTypeId.MomentOfInertia, UnitTypeId.FeetToTheFourthPower },

        // Structural Dimensions
        { SpecTypeId.SectionDimension, UnitTypeId.Feet },
        { SpecTypeId.SectionArea, UnitTypeId.SquareFeet },
        { SpecTypeId.SectionModulus, UnitTypeId.CubicFeet },
        { SpecTypeId.SectionProperty, UnitTypeId.Feet },
        { SpecTypeId.WarpingConstant, UnitTypeId.FeetToTheSixthPower },
        { SpecTypeId.SurfaceAreaPerUnitLength, UnitTypeId.SquareFeetPerFoot },

        // Reinforcement
        { SpecTypeId.BarDiameter, UnitTypeId.Inches },
        { SpecTypeId.ReinforcementLength, UnitTypeId.Feet },
        { SpecTypeId.ReinforcementSpacing, UnitTypeId.Feet },
        { SpecTypeId.ReinforcementCover, UnitTypeId.Feet },
        { SpecTypeId.ReinforcementArea, UnitTypeId.SquareInches },
        { SpecTypeId.ReinforcementAreaPerUnitLength, UnitTypeId.SquareInchesPerFoot },
        { SpecTypeId.ReinforcementVolume, UnitTypeId.CubicFeet },
        { SpecTypeId.CrackWidth, UnitTypeId.Inches },

        // Structural Analysis
        { SpecTypeId.Displacement, UnitTypeId.Inches },
        { SpecTypeId.Rotation, UnitTypeId.Radians },
        { SpecTypeId.Stress, UnitTypeId.PoundsForcePerSquareInch },
        { SpecTypeId.PointSpringCoefficient, UnitTypeId.KipsPerInch },
        { SpecTypeId.LineSpringCoefficient, UnitTypeId.KipsPerSquareFoot },
        { SpecTypeId.AreaSpringCoefficient, UnitTypeId.KipsPerCubicInch },
        { SpecTypeId.RotationalPointSpringCoefficient, UnitTypeId.KipFeetPerDegree },
        { SpecTypeId.RotationalLineSpringCoefficient, UnitTypeId.KipFeetPerDegreePerFoot },

        // Structural Dynamics
        { SpecTypeId.Acceleration, UnitTypeId.FeetPerSecondSquared },
        { SpecTypeId.StructuralVelocity, UnitTypeId.FeetPerSecond },
        { SpecTypeId.StructuralFrequency, UnitTypeId.Hertz },
        { SpecTypeId.Period, UnitTypeId.Seconds },
        { SpecTypeId.Pulsation, UnitTypeId.RadiansPerSecond },
        { SpecTypeId.Energy, UnitTypeId.PoundForceFeet },

        // Structural Material Properties
        { SpecTypeId.ThermalExpansionCoefficient, UnitTypeId.InverseDegreesFahrenheit },

        // ═══════════════════════════════════════════════════════════
        // ELECTRICAL DISCIPLINE
        // ═══════════════════════════════════════════════════════════

        { SpecTypeId.ElectricalPotential, UnitTypeId.Volts },
        { SpecTypeId.Current, UnitTypeId.Amperes },
        { SpecTypeId.ApparentPower, UnitTypeId.VoltAmperes },
        { SpecTypeId.ElectricalPower, UnitTypeId.Watts },
        { SpecTypeId.Wattage, UnitTypeId.Watts },
        { SpecTypeId.ElectricalFrequency, UnitTypeId.Hertz },
        { SpecTypeId.ElectricalPowerDensity, UnitTypeId.WattsPerSquareFoot },
        { SpecTypeId.PowerPerLength, UnitTypeId.WattsPerFoot },
        { SpecTypeId.ApparentPowerDensity, UnitTypeId.VoltAmperesPerSquareFoot },
        { SpecTypeId.ElectricalResistivity, UnitTypeId.OhmMeters },
        { SpecTypeId.ElectricalTemperature, UnitTypeId.Fahrenheit },
        { SpecTypeId.ElectricalTemperatureDifference, UnitTypeId.FahrenheitInterval },
        { SpecTypeId.CostRateEnergy, UnitTypeId.CurrencyPerWattHour },
        { SpecTypeId.CostRatePower, UnitTypeId.CurrencyPerWatt },
        { SpecTypeId.DemandFactor, UnitTypeId.Fixed },

        // Lighting
        { SpecTypeId.Illuminance, UnitTypeId.Footcandles },
        { SpecTypeId.Luminance, UnitTypeId.CandelasPerSquareMeter },
        { SpecTypeId.LuminousFlux, UnitTypeId.Lumens },
        { SpecTypeId.LuminousIntensity, UnitTypeId.Candelas },
        { SpecTypeId.Efficacy, UnitTypeId.LumensPerWatt },
        { SpecTypeId.ColorTemperature, UnitTypeId.Kelvin },

        // Electrical Sizes
        { SpecTypeId.CableTraySize, UnitTypeId.Inches },
        { SpecTypeId.ConduitSize, UnitTypeId.Inches },
        { SpecTypeId.WireDiameter, UnitTypeId.Inches },

        // ═══════════════════════════════════════════════════════════
        // HVAC DISCIPLINE
        // ═══════════════════════════════════════════════════════════

        { SpecTypeId.AirFlow, UnitTypeId.CubicFeetPerMinute },
        { SpecTypeId.HvacPressure, UnitTypeId.PoundsForcePerSquareInch },
        { SpecTypeId.HvacTemperature, UnitTypeId.Fahrenheit },
        { SpecTypeId.HvacTemperatureDifference, UnitTypeId.FahrenheitInterval },
        { SpecTypeId.HvacPower, UnitTypeId.Watts },
        { SpecTypeId.HvacPowerDensity, UnitTypeId.WattsPerSquareFoot },
        { SpecTypeId.CoolingLoad, UnitTypeId.BritishThermalUnitsPerHour },
        { SpecTypeId.HeatingLoad, UnitTypeId.BritishThermalUnitsPerHour },
        { SpecTypeId.HeatGain, UnitTypeId.BritishThermalUnitsPerHour },
        { SpecTypeId.HvacVelocity, UnitTypeId.FeetPerMinute },
        { SpecTypeId.DuctSize, UnitTypeId.Inches },
        { SpecTypeId.DuctInsulationThickness, UnitTypeId.Inches },
        { SpecTypeId.DuctLiningThickness, UnitTypeId.Inches },
        { SpecTypeId.HvacDensity, UnitTypeId.PoundsMassPerCubicFoot },
        { SpecTypeId.HvacViscosity, UnitTypeId.Centipoises },
        { SpecTypeId.HvacFriction, UnitTypeId.InchesOfWater60DegreesFahrenheitPer100Feet },
        { SpecTypeId.HvacRoughness, UnitTypeId.Feet },
        { SpecTypeId.HvacSlope, UnitTypeId.RiseDividedBy12Inches },
        { SpecTypeId.AirFlowDensity, UnitTypeId.CubicFeetPerMinuteSquareFoot },
        { SpecTypeId.AirFlowDividedByCoolingLoad, UnitTypeId.CubicFeetPerMinuteTonOfRefrigeration },
        { SpecTypeId.AirFlowDividedByVolume, UnitTypeId.CubicFeetPerMinuteCubicFoot },
        { SpecTypeId.AreaDividedByCoolingLoad, UnitTypeId.SquareFeetPerTonOfRefrigeration },
        { SpecTypeId.AreaDividedByHeatingLoad, UnitTypeId.SquareMetersPerKilowatt },
        { SpecTypeId.CoolingLoadDividedByArea, UnitTypeId.BritishThermalUnitsPerHourSquareFoot },
        { SpecTypeId.CoolingLoadDividedByVolume, UnitTypeId.BritishThermalUnitsPerHourCubicFoot },
        { SpecTypeId.HeatingLoadDividedByArea, UnitTypeId.BritishThermalUnitsPerHourSquareFoot },
        { SpecTypeId.HeatingLoadDividedByVolume, UnitTypeId.BritishThermalUnitsPerHourCubicFoot },
        { SpecTypeId.FlowPerPower, UnitTypeId.LitersPerSecondKilowatt },
        { SpecTypeId.PowerPerFlow, UnitTypeId.WattsPerCubicFootPerMinute },
        { SpecTypeId.HvacMassPerTime, UnitTypeId.PoundsMassPerHour },
        { SpecTypeId.CrossSection, UnitTypeId.SquareFeet },
        { SpecTypeId.Diffusivity, UnitTypeId.SquareFeetPerSecond },
        { SpecTypeId.Factor, UnitTypeId.Fixed },
        { SpecTypeId.AngularSpeed, UnitTypeId.RevolutionsPerMinute },

        // ═══════════════════════════════════════════════════════════
        // PIPING DISCIPLINE
        // ═══════════════════════════════════════════════════════════

        { SpecTypeId.Flow, UnitTypeId.UsGallonsPerMinute },
        { SpecTypeId.PipingPressure, UnitTypeId.PoundsForcePerSquareInch },
        { SpecTypeId.PipingTemperature, UnitTypeId.Fahrenheit },
        { SpecTypeId.PipingTemperatureDifference, UnitTypeId.FahrenheitInterval },
        { SpecTypeId.PipeSize, UnitTypeId.Inches },
        { SpecTypeId.PipeDimension, UnitTypeId.Inches },
        { SpecTypeId.PipeInsulationThickness, UnitTypeId.Inches },
        { SpecTypeId.PipingVelocity, UnitTypeId.FeetPerSecond },
        { SpecTypeId.PipingDensity, UnitTypeId.PoundsMassPerCubicFoot },
        { SpecTypeId.PipingViscosity, UnitTypeId.Centipoises },
        { SpecTypeId.PipingFriction, UnitTypeId.FeetOfWater39_2DegreesFahrenheitPer100Feet },
        { SpecTypeId.PipingRoughness, UnitTypeId.Feet },
        { SpecTypeId.PipingSlope, UnitTypeId.RiseDividedBy12Inches },
        { SpecTypeId.PipingVolume, UnitTypeId.CubicFeet },
        { SpecTypeId.PipingMass, UnitTypeId.PoundsMass },
        { SpecTypeId.PipingMassPerTime, UnitTypeId.PoundsMassPerHour },
        { SpecTypeId.PipeMassPerUnitLength, UnitTypeId.PoundsMassPerFoot },

        // ═══════════════════════════════════════════════════════════
        // ENERGY ANALYSIS DISCIPLINE
        // ═══════════════════════════════════════════════════════════

        { SpecTypeId.HvacEnergy, UnitTypeId.BritishThermalUnits },
        { SpecTypeId.HeatCapacityPerArea, UnitTypeId.BritishThermalUnitsPerSquareFootDegreeFahrenheit },
        { SpecTypeId.HeatTransferCoefficient, UnitTypeId.BritishThermalUnitsPerHourSquareFootDegreeFahrenheit },
        { SpecTypeId.ThermalConductivity, UnitTypeId.BritishThermalUnitsPerHourFootDegreeFahrenheit },
        { SpecTypeId.ThermalResistance, UnitTypeId.HourSquareFootDegreesFahrenheitPerBritishThermalUnit },
        { SpecTypeId.ThermalMass, UnitTypeId.BritishThermalUnitsPerDegreeFahrenheit },
        { SpecTypeId.SpecificHeat, UnitTypeId.BritishThermalUnitsPerPoundDegreeFahrenheit },
        { SpecTypeId.SpecificHeatOfVaporization, UnitTypeId.BritishThermalUnitsPerPound },
        { SpecTypeId.Permeability, UnitTypeId.NanogramsPerPascalSecondSquareMeter },
        { SpecTypeId.IsothermalMoistureCapacity, UnitTypeId.PoundsMassPerPoundDegreeFahrenheit },
        { SpecTypeId.ThermalGradientCoefficientForMoistureCapacity, UnitTypeId.InverseDegreesFahrenheit },

        // ═══════════════════════════════════════════════════════════
        // INFRASTRUCTURE DISCIPLINE
        // ═══════════════════════════════════════════════════════════

        { SpecTypeId.Stationing, UnitTypeId.Feet },
        { SpecTypeId.StationingInterval, UnitTypeId.Feet }
    };

    public bool CanMap(CoercionContext context) {
        // Only handle measurable → number conversions
        if (context.TargetStorageType != StorageType.Double) return false;
        if (context.TargetDataType != SpecTypeId.Number) return false;
        if (context.SourceDataType == null) return false;
        if (!UnitUtils.IsMeasurableSpec(context.SourceDataType)) return false;

        // Check if we have a default target unit for this source type (single lookup)
        return DefaultTargetUnits.TryGetValue(context.SourceDataType, out _);
    }

    public Result<FamilyParameter> Map(CoercionContext context) {
        if (context.SourceDataType == null)
            throw new ArgumentException("Source data type is null");

        if (!DefaultTargetUnits.TryGetValue(context.SourceDataType, out var targetUnit)) {
            var firstTenKeys = string.Join(", ", DefaultTargetUnits.Keys.Take(10).Select(k => k.TypeId));
            throw new ArgumentException(
                $"No default target unit defined for source type '{context.SourceDataType.TypeId}'. First 10 available: {firstTenKeys}");
        }

        var sourceValue = context.SourceValue as double? ?? 0;

        // Revit stores mass internally as kilograms
        // ConvertFromInternalUnits converts from internal (kg) to target unit (lb)
        double convertedValue;
        try {
            convertedValue = UnitUtils.ConvertFromInternalUnits(sourceValue, targetUnit);
        } catch (Exception ex) {
            throw new InvalidOperationException(
                $"Failed to convert {sourceValue} from internal units to {targetUnit.TypeId}: {ex.Message}", ex);
        }

        // Set the converted value as a unitless number
        var fm = context.FamilyManager;
        try {
            fm.Set(context.TargetParam, convertedValue);
        } catch (Exception ex) {
            throw new InvalidOperationException(
                $"Failed to set parameter '{context.TargetParam.Definition.Name}' to value {convertedValue}: {ex.Message}",
                ex);
        }

        return context.TargetParam;
    }
}