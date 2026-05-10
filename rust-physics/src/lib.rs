use serde::Serialize;
use wasm_bindgen::prelude::*;

const G: f64 = 0.52;
const FIXED_TIME_STEP: f64 = 1.0 / 360.0;
const MAX_FRAME_TIME: f64 = 0.25;
const SOFTENING: f64 = 0.01;
const MAX_STEPS_PER_FRAME: usize = 180;
const TIME_SCALE: f64 = 0.75;

#[derive(Clone)]
struct BodyState {
    mass: f64,
    position: [f64; 3],
    velocity: [f64; 3],
}

#[derive(Clone)]
struct BodyTemplate {
    name: &'static str,
    mass: f64,
    radius: f32,
    orbit_radius: f64,
    phase: f64,
    inclination: f64,
    color: &'static str,
    trail_color: &'static str,
    glow_color: &'static str,
    parent_index: Option<usize>,
    is_sun: bool,
}

#[derive(Clone, Serialize)]
struct BodyMetadata {
    name: String,
    radius: f32,
    color: String,
    trail_color: String,
    glow_color: String,
    parent_index: Option<usize>,
    is_sun: bool,
}

#[wasm_bindgen]
pub struct GravitySimulation {
    templates: Vec<BodyTemplate>,
    initial_bodies: Vec<BodyState>,
    bodies: Vec<BodyState>,
    paused: bool,
    accumulator: f64,
}

#[wasm_bindgen]
impl GravitySimulation {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let templates = default_templates();
        let initial_bodies = build_initial_states(&templates);

        Self {
            templates,
            initial_bodies: initial_bodies.clone(),
            bodies: initial_bodies,
            paused: false,
            accumulator: 0.0,
        }
    }

    pub fn update(&mut self, real_delta_seconds: f64, simulation_speed: f64) {
        if self.paused {
            return;
        }

        let delta = real_delta_seconds.clamp(0.0, MAX_FRAME_TIME);
        self.accumulator += delta * simulation_speed.max(0.0) * TIME_SCALE;

        let mut steps = 0;
        while self.accumulator >= FIXED_TIME_STEP && steps < MAX_STEPS_PER_FRAME {
            self.integrate(FIXED_TIME_STEP);
            self.accumulator -= FIXED_TIME_STEP;
            steps += 1;
        }
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn reset(&mut self) {
        self.bodies = self.initial_bodies.clone();
        self.accumulator = 0.0;
        self.paused = false;
    }

    pub fn body_count(&self) -> usize {
        self.bodies.len()
    }

    pub fn get_positions(&self) -> Vec<f32> {
        let mut positions = Vec::with_capacity(self.bodies.len() * 3);

        for body in &self.bodies {
            positions.push(body.position[0] as f32);
            positions.push(body.position[1] as f32);
            positions.push(body.position[2] as f32);
        }

        positions
    }

    pub fn get_body_metadata(&self) -> Result<JsValue, JsValue> {
        let metadata: Vec<BodyMetadata> = self
            .templates
            .iter()
            .map(|template| BodyMetadata {
                name: template.name.to_string(),
                radius: template.radius,
                color: template.color.to_string(),
                trail_color: template.trail_color.to_string(),
                glow_color: template.glow_color.to_string(),
                parent_index: template.parent_index,
                is_sun: template.is_sun,
            })
            .collect();

        serde_wasm_bindgen::to_value(&metadata)
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

impl GravitySimulation {
    fn integrate(&mut self, step: f64) {
        let accelerations_before = self.compute_accelerations();

        for (body, acceleration) in self.bodies.iter_mut().zip(accelerations_before.iter()) {
            body.position[0] += body.velocity[0] * step + 0.5 * acceleration[0] * step * step;
            body.position[1] += body.velocity[1] * step + 0.5 * acceleration[1] * step * step;
            body.position[2] += body.velocity[2] * step + 0.5 * acceleration[2] * step * step;
        }

        let accelerations_after = self.compute_accelerations();

        for ((body, before), after) in self
            .bodies
            .iter_mut()
            .zip(accelerations_before.iter())
            .zip(accelerations_after.iter())
        {
            body.velocity[0] += 0.5 * (before[0] + after[0]) * step;
            body.velocity[1] += 0.5 * (before[1] + after[1]) * step;
            body.velocity[2] += 0.5 * (before[2] + after[2]) * step;
        }
    }

    fn compute_accelerations(&self) -> Vec<[f64; 3]> {
        let mut accelerations = vec![[0.0, 0.0, 0.0]; self.bodies.len()];

        for i in 0..self.bodies.len() {
            for j in (i + 1)..self.bodies.len() {
                let dx = self.bodies[j].position[0] - self.bodies[i].position[0];
                let dy = self.bodies[j].position[1] - self.bodies[i].position[1];
                let dz = self.bodies[j].position[2] - self.bodies[i].position[2];

                let distance_squared = dx * dx + dy * dy + dz * dz + SOFTENING;
                let distance = distance_squared.sqrt();
                let inverse_distance_cubed = 1.0 / (distance_squared * distance);

                let scale_i = G * self.bodies[j].mass * inverse_distance_cubed;
                let scale_j = G * self.bodies[i].mass * inverse_distance_cubed;

                accelerations[i][0] += dx * scale_i;
                accelerations[i][1] += dy * scale_i;
                accelerations[i][2] += dz * scale_i;

                accelerations[j][0] -= dx * scale_j;
                accelerations[j][1] -= dy * scale_j;
                accelerations[j][2] -= dz * scale_j;
            }
        }

        accelerations
    }
}

fn default_templates() -> Vec<BodyTemplate> {
    vec![
        BodyTemplate {
            name: "Sun",
            mass: 5600.0,
            radius: 4.9,
            orbit_radius: 0.0,
            phase: 0.0,
            inclination: 0.0,
            color: "#f5a33f",
            trail_color: "#ffcd85",
            glow_color: "#ffd36e",
            parent_index: None,
            is_sun: true,
        },
        BodyTemplate {
            name: "Mercury",
            mass: 0.09,
            radius: 0.34,
            orbit_radius: 12.0,
            phase: 0.3,
            inclination: 0.08,
            color: "#9f8d80",
            trail_color: "#9e8778",
            glow_color: "#d1b59a",
            parent_index: Some(0),
            is_sun: false,
        },
        BodyTemplate {
            name: "Venus",
            mass: 0.2,
            radius: 0.72,
            orbit_radius: 18.0,
            phase: 0.95,
            inclination: 0.05,
            color: "#d4b07a",
            trail_color: "#d9be93",
            glow_color: "#f4d8b0",
            parent_index: Some(0),
            is_sun: false,
        },
        BodyTemplate {
            name: "Earth",
            mass: 0.24,
            radius: 0.78,
            orbit_radius: 26.0,
            phase: 1.8,
            inclination: 0.03,
            color: "#467fdd",
            trail_color: "#7dbdf8",
            glow_color: "#90d9ff",
            parent_index: Some(0),
            is_sun: false,
        },
        BodyTemplate {
            name: "Moon",
            mass: 0.003,
            radius: 0.24,
            orbit_radius: 2.8,
            phase: 0.4,
            inclination: 0.16,
            color: "#d8dce1",
            trail_color: "#edf1f4",
            glow_color: "#ffffff",
            parent_index: Some(3),
            is_sun: false,
        },
        BodyTemplate {
            name: "Mars",
            mass: 0.14,
            radius: 0.52,
            orbit_radius: 36.0,
            phase: 2.5,
            inclination: 0.07,
            color: "#b25a3e",
            trail_color: "#d88661",
            glow_color: "#ffb292",
            parent_index: Some(0),
            is_sun: false,
        },
        BodyTemplate {
            name: "Jupiter",
            mass: 7.0,
            radius: 1.85,
            orbit_radius: 54.0,
            phase: 3.3,
            inclination: 0.04,
            color: "#be9d78",
            trail_color: "#dcc09e",
            glow_color: "#ffe3bc",
            parent_index: Some(0),
            is_sun: false,
        },
        BodyTemplate {
            name: "Saturn",
            mass: 4.2,
            radius: 1.62,
            orbit_radius: 72.0,
            phase: 4.0,
            inclination: 0.08,
            color: "#cab98a",
            trail_color: "#e7d7a7",
            glow_color: "#fff0bf",
            parent_index: Some(0),
            is_sun: false,
        },
        BodyTemplate {
            name: "Uranus",
            mass: 0.9,
            radius: 1.18,
            orbit_radius: 92.0,
            phase: 4.8,
            inclination: 0.1,
            color: "#74c4cf",
            trail_color: "#97e8ef",
            glow_color: "#bffcff",
            parent_index: Some(0),
            is_sun: false,
        },
        BodyTemplate {
            name: "Neptune",
            mass: 1.1,
            radius: 1.12,
            orbit_radius: 112.0,
            phase: 5.5,
            inclination: 0.06,
            color: "#4568c8",
            trail_color: "#6e93ff",
            glow_color: "#b0c5ff",
            parent_index: Some(0),
            is_sun: false,
        },
    ]
}

fn build_initial_states(templates: &[BodyTemplate]) -> Vec<BodyState> {
    let mut states: Vec<BodyState> = Vec::with_capacity(templates.len());

    for template in templates {
        if let Some(parent_index) = template.parent_index {
            let parent = &states[parent_index];
            let orbital_speed = (G * (parent.mass + template.mass) / template.orbit_radius).sqrt();

            let local_position = rotate_x(
                [
                    template.orbit_radius * template.phase.cos(),
                    0.0,
                    template.orbit_radius * template.phase.sin(),
                ],
                template.inclination,
            );
            let local_velocity = rotate_x(
                [
                    -orbital_speed * template.phase.sin(),
                    0.0,
                    orbital_speed * template.phase.cos(),
                ],
                template.inclination,
            );

            states.push(BodyState {
                mass: template.mass,
                position: [
                    parent.position[0] + local_position[0],
                    parent.position[1] + local_position[1],
                    parent.position[2] + local_position[2],
                ],
                velocity: [
                    parent.velocity[0] + local_velocity[0],
                    parent.velocity[1] + local_velocity[1],
                    parent.velocity[2] + local_velocity[2],
                ],
            });
        } else {
            states.push(BodyState {
                mass: template.mass,
                position: [0.0, 0.0, 0.0],
                velocity: [0.0, 0.0, 0.0],
            });
        }
    }

    recenter_barycenter(states)
}

fn recenter_barycenter(mut states: Vec<BodyState>) -> Vec<BodyState> {
    let total_mass: f64 = states.iter().map(|body| body.mass).sum();

    let mut center_of_mass = [0.0, 0.0, 0.0];
    let mut velocity_center = [0.0, 0.0, 0.0];

    for body in &states {
        center_of_mass[0] += body.position[0] * body.mass;
        center_of_mass[1] += body.position[1] * body.mass;
        center_of_mass[2] += body.position[2] * body.mass;

        velocity_center[0] += body.velocity[0] * body.mass;
        velocity_center[1] += body.velocity[1] * body.mass;
        velocity_center[2] += body.velocity[2] * body.mass;
    }

    center_of_mass[0] /= total_mass;
    center_of_mass[1] /= total_mass;
    center_of_mass[2] /= total_mass;
    velocity_center[0] /= total_mass;
    velocity_center[1] /= total_mass;
    velocity_center[2] /= total_mass;

    for body in &mut states {
        body.position[0] -= center_of_mass[0];
        body.position[1] -= center_of_mass[1];
        body.position[2] -= center_of_mass[2];

        body.velocity[0] -= velocity_center[0];
        body.velocity[1] -= velocity_center[1];
        body.velocity[2] -= velocity_center[2];
    }

    states
}

fn rotate_x(vector: [f64; 3], angle: f64) -> [f64; 3] {
    let cos_angle = angle.cos();
    let sin_angle = angle.sin();

    [
        vector[0],
        vector[1] * cos_angle - vector[2] * sin_angle,
        vector[1] * sin_angle + vector[2] * cos_angle,
    ]
}
