import React from 'react';

export const AboutPage: React.FC = () => {
  return (
    <section className="v">
      <h2>About and methodology</h2>
      <p className="lede">
        Distance is not the same as access. UNREACHABLE combines verified municipal road geometry,
        standardized emergency vehicle clearance profiles, citizen hazard reports, and AI-assisted
        street-level imagery analysis to reveal where access is uncertain or blocked before an emergency occurs.
      </p>

      {/* 4 Steps */}
      <div className="stp">
        <div>
          <b>1</b>
          <p>
            <b>Collect evidence:</b> Compile road network centerlines, cadastral footprints, physical widths,
            and municipal hazard reports.
          </p>
        </div>
        <div>
          <b>2</b>
          <p>
            <b>Inspect:</b> Street photos are parsed by AI vision models into structured observations
            for human engineers to verify.
          </p>
        </div>
        <div>
          <b>3</b>
          <p>
            <b>Analyse access:</b> Vehicle width and height envelopes are tested against every corridor segment.
          </p>
        </div>
        <div>
          <b>4</b>
          <p>
            <b>Prioritize:</b> Proposed physical interventions are ranked by the total volume of building
            footprints unlocked.
          </p>
        </div>
      </div>

      <h3>Three kinds of information</h3>
      <p className="lede" style={{ marginBottom: '20px' }}>
        <b>Unknown</b> means no measurement exists in records. Unknown is never treated as inaccessible;
        it flags an urgent need for an in-person field check. <b>AI-observed</b> indicates an automated vision
        model identified an anomaly that has not yet been audited. <b>Verified</b> means an authorized human surveyor
        or emergency official confirmed the ground truth.
      </p>

      <h3>Shared bottlenecks</h3>
      <p className="lede" style={{ marginBottom: '20px' }}>
        A single choked arterial, illegally parked delivery van, or low sagging optical cable bundle can
        sever emergency ingress for dozens of interior residential buildings. UNREACHABLE models these shared
        network dependencies so municipal planners can fix the single link that delivers the highest public safety return.
      </p>

      <h3>System limits & design philosophy</h3>
      <p className="lede" style={{ marginBottom: '20px' }}>
        The current dataset is a synthetic demonstration model calibrated for Indian urban conditions.
        Vehicle width profiles are illustrative benchmarks. Travel times and real-time dynamic traffic delays
        are deliberately omitted until defensible telematics models are validated. UNREACHABLE supports emergency
        professionals and municipal authorities; it never supersedes them.
      </p>

      <div className="cta" style={{ marginTop: '24px' }}>
        <a className="btn pri" href="#/">
          Back to overview
        </a>
      </div>

      <p className="dis">
        Decision-support prototype for urban emergency preparedness. Not a replacement for emergency
        dispatch (112 / Fire / EMS) or statutory municipal safety certifications.
      </p>
    </section>
  );
};
